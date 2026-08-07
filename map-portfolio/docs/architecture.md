# 技术架构

## 页面

- React 负责界面和状态。
- TypeScript 负责数据类型和编译检查。
- CesiumJS 负责三维相机、经纬度、点位和真实地形接口。
- Natural Earth 简化国界负责“中国区域”裁剪和演示板块。
- Lucide 提供统一图标。

## 数据流

```text
项目管理表单
  -> /api/projects
  -> server/local-db/projects.json
  -> 地图页面重新读取
  -> 筛选逻辑
  -> Cesium 项目实体和详情面板
```

## 本地服务

- 只监听 `127.0.0.1`，不会主动向局域网开放。
- Express 提供项目接口、上传、备份和恢复。
- 写入 JSON 时先写临时文件再替换，避免半写入损坏。
- 图片使用系统生成文件名，限制类型和 8MB 大小。

## 未来迁移

当项目超过 100 条或需要公网使用时，保留 `Project` 数据结构，把 `projectRepository` 的实现换成 Supabase。地图组件和界面不需要因此重写。
