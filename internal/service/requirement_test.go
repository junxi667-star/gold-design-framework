package service

import (
	"testing"

	"jewelchain-studio/internal/model"
)

func TestRequirementAndPromptGoldenContract(t *testing.T) {
	requirement, summary := parseRequirement("给妈妈设计一款足金莲花吊坠，日常佩戴，15-18克，预算5000元以内，古法感但不要太花，边缘圆润不刮手", nil)
	if model.String(requirement, "taskType") != "new_design" || model.String(requirement, "productType") != "吊坠" || model.String(requirement, "goldType") != "足金" {
		t.Fatalf("unexpected normalized requirement: %#v", requirement)
	}
	if model.String(requirement, "style") != "古法金视觉质感、温润" || model.String(requirement, "weightRequirement") != "15-18克" || model.String(requirement, "budget") != "5000元以内" {
		t.Fatalf("lost parsed requirement fields: %#v", requirement)
	}
	if summary != "已从客户原话和明确字段整理：吊坠；母亲、中年女性（年龄待确认）；日常佩戴；古法金视觉质感、温润；莲花；15-18克。模糊词未被转换成未经确认的硬参数，仍需人工确认 黄金类型、尺寸或佩戴参数、真实工艺要求。" {
		t.Fatalf("unexpected understanding summary: %s", summary)
	}
	prompt, err := buildGoldAPIImagePrompt(requirement, "generate", "")
	if err != nil {
		t.Fatal(err)
	}
	if model.String(prompt, "productType") != "pendant" || model.String(prompt, "shape") != "圆形吊坠" {
		t.Fatalf("unexpected product template: %#v", prompt)
	}
	want := "请生成一张高级珠宝产品摄影风格的吊坠概念效果图。 主体：单个吊坠。 款式形状：圆形吊坠。 风格：古法金视觉质感、温润。 设计元素：莲花。 适合人群：母亲、中年女性（年龄待确认）。 使用场景：日常佩戴。 重量或视觉倾向：15-18克。 材质：足金，需要真实黄金金属光泽与高级珠宝质感。 只展示单个吊坠主体，可带吊环，不要整条项链，不要人物佩戴图。 构图要求：产品居中，背景干净，白底或浅灰底，边缘清晰，结构合理，可佩戴。 禁止内容：不要人物，不要手模，不要文字，不要 logo，不要水印，不要多个产品，不要漂浮断裂结构。"
	if model.String(prompt, "apiPrompt") != want {
		t.Fatalf("prompt contract diverged:\nwant: %s\n got: %s", want, model.String(prompt, "apiPrompt"))
	}
}

func TestRequirementFormOverridesAndRevisionDoesNotInventProduct(t *testing.T) {
	parsed, _ := parseGoldRequirement("保留原图造型，只改成磨砂质感", model.Record{"productType": "手镯", "motifs": []any{"祥云", "莲花"}})
	if model.String(parsed, "taskType") != "modify_existing" || model.String(parsed, "productType") != "手镯" || len(model.Strings(parsed["motifs"])) != 2 {
		t.Fatalf("form fields were not faithfully applied: %#v", parsed)
	}
	change, _ := parseRevisionRequirement("把表面改成磨砂")
	if model.String(change, "productType") != "" {
		t.Fatalf("revision parser invented a product type: %#v", change)
	}
}
