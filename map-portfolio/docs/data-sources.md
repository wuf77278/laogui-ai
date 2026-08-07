# 地图与数据来源

## 当前使用

- 三维引擎：CesiumJS，Apache-2.0。
- 简化国界：Natural Earth 1:110m，通过 `world-atlas` 使用。
- 演示地表：Cesium 安装包中的 Natural Earth II 低精度纹理。
- 项目资料：本项目虚构的示例数据。

Natural Earth 属于公共领域数据，但仍应在说明中保留来源。

## 真实地形

填写 `CESIUM_ION_TOKEN` 后使用 Cesium World Terrain。地形和影像是两类独立数据，后续可以替换成合规的国内服务。

## 禁止事项

- 不抓取未经授权的卫星图片。
- 不把平台估算值写成官方人流量。
- 不展示没有来源和更新时间的酒店价格。
- 不把简化国界用于测量、导航或测绘。
