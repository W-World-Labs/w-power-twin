# W Power Twin

完整的教学与演示用电厂数字孪生应用源码：热电、陆上风电、海上风电、光伏和熔盐塔式光热五类场景，包含自有 Rust 合成过程模型、能量平衡、故障特征融合、目录校验，以及双语 React／Three.js 场景、设备导览、剖视和运行仪表盘。

设备、容量、位置和 KKS 风格标签均为示意；`/api/telemetry` 根据请求所选场景与故障生成一致的合成信号。它不是实际电厂控制系统、客户现场数据、IAPWS-IF97 求解器或已接入的视频／音频／VLM 推理。源码公开与真实设备、模型、工程精度和生产验收分别判断。

## 运行与源码范围

运行者需要 Rust 工具链、Node.js 和 npm。以下命令供运行者在自己授权的环境执行：

```sh
cd frontend
npm ci --ignore-scripts
npm run build
cd ../server
cargo run --locked
```

服务默认监听 `127.0.0.1:18470`，提供 `/health`、`/api/plant?scene=...`、`/api/telemetry?scene=...&scenario=...`、本机资产目录和构建后的前端。`?scene=thermal|onshore|offshore|solar|csp` 选择场景；未知或跨场景故障由原有校验拒绝。演示接口没有用户登录和租户隔离，不应当作带访问控制的生产平台。

| 配置 | 默认／用途 |
| --- | --- |
| `POWER_TWIN_BIND` | `127.0.0.1:18470` |
| `POWER_TWIN_PLANT_FILE` | `data/plant.json` |
| `POWER_TWIN_RENEWABLES_FILE` | 与热电目录相邻的 `renewables.json` |
| `POWER_TWIN_ASSETS_DIR` | `assets/` |
| `POWER_TWIN_DIST_DIR` | `frontend/dist/` |
| `POWER_TWIN_BACKEND` | 前端开发代理地址，默认 `http://127.0.0.1:18470` |

`server/src/telemetry.rs`、`renewable.rs` 和 `csp.rs` 保留原有合成算法及断言；`data/plant.json`、`renewables.json` 是这些算法与设备图的单一来源。所有原有前端主实现都在 `frontend/src/`，没有替换成 SDK 壳。

## 外部资产与数据

本发行**不附带** HDRI、纹理、GLB、模型权重、音频／振动数据集、参考航拍图或资产运行锁文件。现有 3D 场景需要运行者另行取得其所选场景的外部资产，尤其 HDRI／PBR；部分设备已有缺失模型回退，但不能据此声称所有场景可在无资产时正常渲染。API 和前端构建验证不等于真实浏览器渲染验收。

`data/sources.json` 保留来源、作者、上游声明许可、使用与变换记录，UI 的署名面板和原有载入路径也保留。镜像可下载、研究用途或“引用来源”不等于完整再分发授权；资产与数据须逐项核对当前原站许可、作者署名和使用限制。数据集默认不下载。

`scripts/fetch_assets.py --id ID` 和 `scripts/optimize_models.sh ID` 是显式操作工具，只有核清所选资产权利后才应运行。它们不随启动或 CI 自动执行；此源码准备过程没有安装依赖、运行产品或下载模型／数据。用户自行添加的第三方资产不因放在仓库外就免除许可义务。

## 可选遥测

默认后端与浏览器均不发送遥测。后端保留原有路由模板、性能 span 与错误捕获，设置 `W_RADAR_CODE` 后必须另供 `W_RADAR_ENDPOINT`；可用 `APP_ENV`、`SERVICE_NAME` 等原配置描述运行者自己的服务。

浏览器遥测须在构建时设置 `POWER_TWIN_BROWSER_TELEMETRY=1`，同时提供 `POWER_TWIN_RADAR_ENDPOINT`、`W_RADAR_WORKSPACE_ID` 和 `W_RADAR_PROJECT_ID`。这些值会公开给浏览器，只能包含非秘密配置；不得放入服务端 API key。外部 bootstrap 是运行者选择的可变脚本，需要运行者负责其服务、安全与隐私约定。本发行不嵌入任何生产端点或工作区身份。

## 许可与验证

W 自有代码、合成目录和文档使用 [MIT](LICENSE)；外部依赖、资产与数据分别保留原权利，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。来源边界与逐文件摘要在 `source-provenance.json`，私有源码历史、运维接线与客户内容不在发行中。

PUBLIC GitHub CI 使用标准 Ubuntu runner，执行原有 Rust 测试和 release 编译、前端类型检查／构建、源码及 Git 历史／全部对象秘密扫描。成功后上传精确提交的源码、许可证声明清单与校验和；不上传二进制或依赖代码，不下载外部资产／数据，也不访问生产服务。源码工件的通过不代表真实浏览器、媒体模型、现场设备或生产运行已验收。
