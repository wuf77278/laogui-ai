# GPT 生图提示词库

本项目的提示词库位于 `prompt-library.mjs`，后端在生成最终提示词前会自动加载。目标不是堆长提示词，而是让每个按钮都有稳定的提示词骨架、失败防护和最终自检。

## 社区资料提炼

- 开源 GPT 图像提示词合集普遍采用“成品图 + 完整提示词 + 分类标签”的结构，适合作为样例库和质量参照。
- 高质量图片提示词通常先定义输出物类型和风格，再拆分主体、构图、细节、材质、光线、色彩和负面约束。
- 图生图/编辑类提示词需要先写清楚保留项，再写修改项，避免模型把原图重绘成新图。
- 建筑/室内提示词需要单独控制空间秩序、相机、材质系统、灯光层级、尺度和可建造性。

## 当前库结构

- `communityPromptKernel(mode)`：通用社区提示词方法，强调分段、约束前置、细节层级和编辑保留项。
- `communityModeControlLines(mode)`：按按钮输出专项规则，比如平面图、3D 平面图、设计系列、材料板和编辑工具。
- `communityPromptBlueprintLines(mode)`：为每个按钮声明输出边界、不可变项、允许变化和失败防护。
- `communityPromptPreflightLines(mode)`：最终提示词提交给生图模型前的自检规则，防止模式跑偏。
- `communityPromptLibraryBlock(options)`：组合完整提示词库块，自动插入到 gpt-5.5 的提示词融合流程。

## 推荐最终提示词顺序

```text
CANVAS
TASK
INPUT / REFERENCES
PRESERVE
TRANSFORM
SCENE / ARTIFACT GRAMMAR
CAMERA / VIEW
MATERIALS
LIGHTING
PALETTE
DETAILS
QUALITY
AVOID
```

## 当前重点

- 平面线稿转彩平：以图片编辑和图纸表达为主，不进入透视渲染语言。
- 平面图转 3D 平面图：先锁定房间形状、相邻关系、开口和动线，再生成 3D cutaway。
- 3D 平面图转效果图：先选择具体空间区域和人视角相机，再展开材料、灯光和陈列。
- 生成设计系列：先定义统一设计 DNA，再按外立面、大堂、卧室、餐厅、卫浴、细节等角色生成。
- 图片编辑工具：只改指定目标，反复强调构图、几何、物体身份和相机不变。

## v3 优化原则

- 每个模块都必须先声明 `Output boundary`，避免所有按钮都被模型理解成通用效果图。
- 有输入图时，`Non-negotiable invariants` 的优先级高于风格词和参考图。
- 参考图只提供可观察证据和质量方向，不能覆盖平面/CAD/现场图的硬几何。
- 最终提示词必须通过 `FINAL_PROMPT_PREFLIGHT`，检查输出物、保留项、允许变化、镜头语言和失败防护是否一致。
- 后端在 `thinkThenGenerateImage` 里还有最终兜底：如果 gpt-5.5 返回的 `final_prompt` 缺少当前模块关键约束，会自动追加 `MANDATORY_GPT_IMAGE_2_MODE_GUARD` 后再交给 gpt-image-2。
- 新增模块时，应同时补 `modulePresetRules`、`modulePromptBlueprints`、前端按钮说明和后端 `promptContractControlLines`。
