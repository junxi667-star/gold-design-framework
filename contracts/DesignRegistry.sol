// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DesignRegistry
/// @notice Records privacy-minimized design version hashes and their parent relationship.
/// @dev This contract deliberately stores no customer text, names, phone numbers, or images.
contract DesignRegistry {
    struct VersionRecord {
        bytes32 contentHash;
        bytes32 parentContentHash;
        string metadataUri;
        address registeredBy;
        uint64 registeredAt;
        uint64 versionNumber;
        bool exists;
        bool finalized;
    }

    error InvalidDesignId();
    error InvalidContentHash();
    error EmptyMetadataUri();
    error DesignAlreadyFinalized(bytes32 finalContentHash);
    error DuplicateContentHash(bytes32 contentHash);
    error RootVersionAlreadyExists();
    error RootVersionRequiresZeroParent();
    error ParentVersionRequired();
    error ParentVersionNotFound(bytes32 parentContentHash);
    error VersionNotFound(bytes32 contentHash);
    error VersionAlreadyFinalized(bytes32 contentHash);
    error UnauthorizedDesignWriter(address expectedOwner, address caller);

    event VersionRegistered(
        bytes32 indexed designId,
        bytes32 indexed contentHash,
        bytes32 indexed parentContentHash,
        uint64 versionNumber,
        address registeredBy,
        string metadataUri
    );

    event VersionFinalized(
        bytes32 indexed designId,
        bytes32 indexed contentHash,
        uint64 versionNumber,
        address finalizedBy
    );

    mapping(bytes32 designId => mapping(bytes32 contentHash => VersionRecord)) private versions;
    mapping(bytes32 designId => address owner) public designOwner;
    mapping(bytes32 designId => bytes32 contentHash) private latestHashes;
    mapping(bytes32 designId => bytes32 contentHash) private finalHashes;
    mapping(bytes32 designId => uint64 count) public versionCount;

    function registerVersion(
        bytes32 designId,
        bytes32 contentHash,
        bytes32 parentContentHash,
        string calldata metadataUri
    ) external returns (uint64 versionNumber) {
        if (designId == bytes32(0)) revert InvalidDesignId();
        if (contentHash == bytes32(0)) revert InvalidContentHash();
        if (bytes(metadataUri).length == 0) revert EmptyMetadataUri();

        bytes32 finalizedHash = finalHashes[designId];
        if (finalizedHash != bytes32(0)) revert DesignAlreadyFinalized(finalizedHash);
        if (versions[designId][contentHash].exists) revert DuplicateContentHash(contentHash);

        uint64 currentCount = versionCount[designId];
        if (currentCount == 0) {
            if (parentContentHash != bytes32(0)) revert RootVersionRequiresZeroParent();
            designOwner[designId] = msg.sender;
        } else {
            address owner = designOwner[designId];
            if (owner != msg.sender) revert UnauthorizedDesignWriter(owner, msg.sender);
            if (parentContentHash == bytes32(0)) revert ParentVersionRequired();
            if (!versions[designId][parentContentHash].exists) {
                revert ParentVersionNotFound(parentContentHash);
            }
        }

        versionNumber = currentCount + 1;
        versions[designId][contentHash] = VersionRecord({
            contentHash: contentHash,
            parentContentHash: parentContentHash,
            metadataUri: metadataUri,
            registeredBy: msg.sender,
            registeredAt: uint64(block.timestamp),
            versionNumber: versionNumber,
            exists: true,
            finalized: false
        });
        versionCount[designId] = versionNumber;
        latestHashes[designId] = contentHash;

        emit VersionRegistered(
            designId,
            contentHash,
            parentContentHash,
            versionNumber,
            msg.sender,
            metadataUri
        );
    }

    function confirmVersion(bytes32 designId, bytes32 contentHash) external {
        address owner = designOwner[designId];
        if (owner != msg.sender) revert UnauthorizedDesignWriter(owner, msg.sender);
        VersionRecord storage record = versions[designId][contentHash];
        if (!record.exists) revert VersionNotFound(contentHash);

        bytes32 finalizedHash = finalHashes[designId];
        if (finalizedHash != bytes32(0)) {
            if (finalizedHash == contentHash) revert VersionAlreadyFinalized(contentHash);
            revert DesignAlreadyFinalized(finalizedHash);
        }

        record.finalized = true;
        finalHashes[designId] = contentHash;
        emit VersionFinalized(designId, contentHash, record.versionNumber, msg.sender);
    }

    function getVersion(
        bytes32 designId,
        bytes32 contentHash
    ) external view returns (VersionRecord memory) {
        VersionRecord memory record = versions[designId][contentHash];
        if (!record.exists) revert VersionNotFound(contentHash);
        return record;
    }

    function getLatest(bytes32 designId) external view returns (VersionRecord memory) {
        bytes32 contentHash = latestHashes[designId];
        if (contentHash == bytes32(0)) revert VersionNotFound(contentHash);
        return versions[designId][contentHash];
    }

    function getFinal(bytes32 designId) external view returns (VersionRecord memory) {
        bytes32 contentHash = finalHashes[designId];
        if (contentHash == bytes32(0)) revert VersionNotFound(contentHash);
        return versions[designId][contentHash];
    }

    function latestContentHash(bytes32 designId) external view returns (bytes32) {
        return latestHashes[designId];
    }

    function finalContentHash(bytes32 designId) external view returns (bytes32) {
        return finalHashes[designId];
    }
}
