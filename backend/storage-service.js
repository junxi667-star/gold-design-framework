import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function storageError(message, { code = "STORAGE_ERROR", details = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = 502;
  error.retryable = true;
  error.details = details;
  return error;
}

function safePathSegment(value) {
  return String(value || "item").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function joinPublic(baseUrl, relativePath) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

export class DesignStorageService {
  constructor({ metadataDir, fetchImpl = globalThis.fetch } = {}) {
    this.metadataDir = metadataDir;
    this.fetchImpl = fetchImpl;
    this.mode = String(process.env.STORAGE_MODE || "auto").toLowerCase();
    this.supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
    this.supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    this.bucket = String(process.env.SUPABASE_PUBLIC_BUCKET || "jewelchain-public").trim();
  }

  get supabaseConfigured() {
    return Boolean(this.fetchImpl && this.supabaseUrl && this.supabaseKey && this.bucket);
  }

  status() {
    const effectiveMode = this.mode === "supabase"
      ? "supabase"
      : this.mode === "local"
        ? "local"
        : this.supabaseConfigured ? "supabase" : "local";
    return {
      requestedMode: this.mode,
      effectiveMode,
      supabaseConfigured: this.supabaseConfigured,
      bucket: this.supabaseConfigured ? this.bucket : null,
      notice: effectiveMode === "supabase"
        ? "设计图片和 Metadata 将保存到 Supabase"
        : "当前使用本地存储；配置 Supabase 后可获得稳定公网 URI",
    };
  }

  async supabaseRequest(url, { method = "POST", body, headers = {} } = {}) {
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        ...headers,
      },
      body,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw storageError(`Supabase 请求失败（HTTP ${response.status}）`, {
        code: "SUPABASE_REQUEST_FAILED",
        details: { status: response.status, response: raw.slice(0, 500) },
      });
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  async uploadObject(objectPath, bytes, contentType) {
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    await this.supabaseRequest(`${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encodedPath}`, {
      method: "POST",
      body: bytes,
      headers: {
        "Content-Type": contentType,
        "x-upsert": "true",
      },
    });
    return `${this.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(this.bucket)}/${encodedPath}`;
  }

  async upsertRows(table, rows, onConflict) {
    return this.supabaseRequest(`${this.supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      body: JSON.stringify(rows),
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
    });
  }

  async updateRows(table, filters, values) {
    const query = Object.entries(filters)
      .map(([key, value]) => `${encodeURIComponent(key)}=eq.${encodeURIComponent(value)}`)
      .join("&");
    return this.supabaseRequest(`${this.supabaseUrl}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      body: JSON.stringify(values),
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
    });
  }

  async prepareImage({ project, version, baseUrl }) {
    const status = this.status();
    if (status.effectiveMode === "supabase") {
      try {
        const projectSegment = safePathSegment(project.localDesignId);
        const versionSegment = `v${version.versionNumber}`;
        const imageBytes = await readFile(version.imageFilePath);
        const objectPath = `designs/${projectSegment}/${versionSegment}/${safePathSegment(version.imageFilename)}`;
        const imageUri = await this.uploadObject(objectPath, imageBytes, version.imageMimeType || "image/png");
        return { storageMode: "supabase", imageUri, warning: null };
      } catch (error) {
        if (this.mode === "supabase") throw error;
        return {
          storageMode: "local",
          imageUri: joinPublic(baseUrl, version.imageUrl),
          warning: `Supabase 图片上传失败，已回退本地：${error.message}`,
        };
      }
    }
    return {
      storageMode: "local",
      imageUri: joinPublic(baseUrl, version.imageUrl),
      warning: "本地/Quick Tunnel URI 会随电脑或隧道关闭而失效；提交前建议配置 Supabase。",
    };
  }

  async persistMetadata({ project, version, metadata, baseUrl, storageMode }) {
    const projectSegment = safePathSegment(project.localDesignId);
    const versionSegment = `v${version.versionNumber}`;
    let metadataUri;
    let warning = null;

    if (storageMode === "supabase" && this.supabaseConfigured) {
      const metadataObject = `designs/${projectSegment}/${versionSegment}/metadata.json`;
      const bytes = Buffer.from(JSON.stringify(metadata, null, 2), "utf8");
      metadataUri = await this.uploadObject(metadataObject, bytes, "application/json; charset=utf-8");
      await this.upsertRows("design_projects", [{
        id: project.id,
        local_design_id: project.localDesignId,
        title: project.title,
        current_version: version.versionNumber,
        final_version_id: project.finalVersionId || null,
        created_at: project.createdAt,
        updated_at: new Date().toISOString(),
      }], "id");
      await this.upsertRows("design_versions", [{
        id: version.id,
        project_id: project.id,
        version_number: version.versionNumber,
        parent_version_id: version.parentVersionId || null,
        parent_content_hash: version.parentContentHash,
        structured_requirement: version.structuredRequirement,
        change_request: version.changeRequest || "",
        prompt_snapshot: { apiPrompt: version.apiPrompt },
        image_url: metadata.imageUri,
        image_hash: version.imageHash,
        metadata_json: metadata,
        metadata_uri: metadataUri,
        content_hash: version.contentHash,
        model_provider: version.modelProvider,
        model_name: version.modelName,
        status: version.status,
        created_at: version.createdAt,
      }], "id");
      return { storageMode: "supabase", metadataUri, warning };
    }

    const targetDir = path.join(this.metadataDir, projectSegment, versionSegment);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    metadataUri = joinPublic(baseUrl, `/metadata/${encodeURIComponent(projectSegment)}/${encodeURIComponent(versionSegment)}/metadata.json`);
    warning = storageMode === "supabase"
      ? "Supabase Metadata 写入未完成，已保存到本地"
      : "本地 Metadata URI 不是永久地址";
    return { storageMode: "local", metadataUri, warning };
  }


  async updateVersionAndProject({ version, project }) {
    if (!this.supabaseConfigured) return null;
    try {
      await this.updateRows("design_versions", { id: version.id }, {
        status: version.status,
        content_hash: version.contentHash || null,
        metadata_uri: version.metadataUri || null,
        updated_at: new Date().toISOString(),
      });
      await this.updateRows("design_projects", { id: project.id }, {
        current_version: project.currentVersion,
        final_version_id: project.finalVersionId || null,
        updated_at: new Date().toISOString(),
      });
      return true;
    } catch {
      return null;
    }
  }

  async saveChainRecord(record) {
    if (!this.supabaseConfigured) return null;
    try {
      return await this.upsertRows("chain_records", [{
        id: record.id,
        version_id: record.versionId,
        chain_id: record.chainId,
        contract_address: record.contractAddress,
        wallet_address: record.walletAddress,
        tx_hash: record.txHash,
        block_number: record.blockNumber || null,
        transaction_kind: record.kind,
        chain_status: record.status,
        submitted_at: record.submittedAt,
        confirmed_at: record.confirmedAt || null,
        error_message: record.errorMessage || null,
        updated_at: new Date().toISOString(),
      }], "id");
    } catch {
      return null;
    }
  }
}
