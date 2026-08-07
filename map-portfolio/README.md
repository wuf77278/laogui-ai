# 设计行迹

这是一个只显示中国区域的三维设计作品地图。正式入口使用 CesiumJS，不再使用旧版手绘中国轮廓和圆锥山峰。

## 小白启动方法

打开终端，依次运行：

```bash
cd "/Users/Apple_501/Desktop/设计师网站/map-portfolio"
npm install
npm run dev
```

看到“设计行迹已启动”后，打开：

- 地图：<http://127.0.0.1:4178/map-portfolio/>
- 项目管理：<http://127.0.0.1:4178/map-portfolio/admin/>

终端窗口不能关闭，关闭后本地网页会停止。

## 当前功能

- 只显示中国板块，不显示完整世界地图
- 旋转、拖动、放大、缩小和恢复中国全景
- 10 条示例设计项目
- 项目光束、标签、点击定位和详情
- 关键词、省份、城市、类型、年份和代表作筛选
- 逐年点亮播放与三档速度
- 中文项目后台
- 项目新增、编辑、删除、公开和隐藏
- 封面图片上传
- JSON 数据备份和恢复
- 没有 Cesium 密钥时自动进入演示模式

## 启用真实地形

1. 复制 `.env.example` 为 `.env`。
2. 在 `.env` 中填写自己的 `CESIUM_ION_TOKEN`。
3. 重新启动 `npm run dev`。

密钥不要发给别人，也不要提交到 Git。

## 检查命令

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 重要目录

- `src/`：正式版本源码
- `server/`：本地接口和项目数据
- `public/uploads/`：后台上传的图片
- `docs/`：产品、架构、数据来源和排错说明
- `legacy-three/`：完整保留的旧版 Three.js 原型

当前项目资料全部是示例数据，不代表真实设计案例。
