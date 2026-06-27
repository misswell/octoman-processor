# 🐙 Octor Compressor

> **免费开源的图片压缩神器** — 图片压缩神器，帮你的图片减减肥

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/guofeng/octor-compressor/releases)

## 📸 截图

![Octor Compressor](website/screenshot.png)

## ✨ 特性

- 🎯 **智能算法选择** — 自动分析图片特征，从多个后端中选择最优算法
- 🚀 **多引擎支持** — 集成 **Sharp**（内置 mozjpeg/oxipng/webp/AVIF/JPEG XL）、**Squoosh**（WASM 引擎，AVIF 最佳）、以及传统 CLI 工具
- 📦 **批量处理** — 支持批量选择图片或拖入整个文件夹，自动递归处理子目录
- 🔄 **多种格式** — 支持 PNG、JPG、GIF、WebP、BMP 格式压缩
- 🆕 **现代格式输出** — 支持输出为 **AVIF**（Squoosh 引擎，压缩率最高）和 **JPEG XL**（下一代 JPEG 标准）
- 📊 **实时对比** — 压缩前后体积、压缩率一目了然
- 🔓 **完全免费** — MIT 开源协议，无需购买激活码
- 🖥️ **桌面应用** — 基于 Electron 构建，原生体验
- ↩️ **恢复原图** — 压缩后不满意可一键恢复原始文件
- 🔄 **实时切换压缩率** — 对比时随时调整质量参数重新压缩，实时对比效果

## 🧩 压缩引擎架构

### 后端优先级

| 优先级 | 后端 | 说明 |
|--------|------|------|
| 🥇 | **Sharp** | Node.js 原生绑定，内置 mozjpeg/oxipng/webp/AVIF/JPEG XL，性能最佳 |
| 🥇 | **Squoosh** | WASM 引擎，**AVIF 编码器显著优于其他后端**（79.3% vs 31.8%） |
| 🥈 | **CLI 工具** | pngquant、gifsicle、cwebp、cjxl、avifenc、oxipng |

### 各格式最佳引擎

| 格式 | 最佳引擎 | 压缩率（典型） | 说明 |
|------|---------|---------------|------|
| PNG | Sharp / OxiPNG | 50-97% | 有损/无损可选 |
| JPEG | Sharp-mozjpeg / Squoosh-mozjpeg | 60-80% | 两者接近，Sharp 略优 |
| GIF | gifsicle | 30-60% | 唯一选项 |
| WebP | **Sharp** | 65-85% | Sharp 优于 Squoosh |
| **AVIF** | **Squoosh ★** | **70-90%** | **Squoosh 显著优于 Sharp (79.3% vs 31.8%)** |
| **JPEG XL** | **CLI cjxl** | **75-92%** | CLI 优于 Squoosh (80.6% vs 71.3%) |

### 压缩率实测对比（370KB 照片 JPG → 质量 75）

| 引擎 | 压缩后 | 节省 | 算法 |
|------|--------|------|------|
| JPEG (Sharp) | 119.9KB | 67.7% | sharp-mozjpeg |
| JPEG (Squoosh) | 119.9KB | 67.6% | squoosh-mozjpeg |
| WebP (Sharp) | 128.0KB | 65.5% | sharp-webp |
| WebP (Squoosh) | 144.0KB | 61.1% | squoosh-webp |
| **AVIF (Squoosh)** | **76.7KB** | **79.3%** | **squoosh-avif** |
| AVIF (CLI) | 84.0KB | 76.8% | avifenc |
| AVIF (Sharp) | 252.6KB | 31.8% | sharp-avif |
| **JPEG XL (CLI)** | **72.0KB** | **80.6%** | **cjxl** |
| JPEG XL (Squoosh) | 106.5KB | 71.3% | squoosh-jxl |

> **结论**: Squoosh 的 AVIF 编码器远超 Sharp（79.3% vs 31.8%），是 AVIF 压缩的最佳选择。JPEG XL 的 CLI 工具 cjxl 提供最佳压缩率（80.6%）。

### Squoosh vs Jpegli 分析

| 维度 | Squoosh | Jpegli |
|------|---------|--------|
| 类型 | WASM 引擎（浏览器/Node.js） | C/C++ 库（libjxl 子项目） |
| 可用性 | npm 包，即装即用 | 需从源码编译（Homebrew 默认关闭） |
| AVIF 编码 | ✅ **优秀**（79.3%） | ❌ 不适用 |
| JPEG 编码 | ✅ 与 mozjpeg 相当 | ✅ 理论上更优（需编译验证） |
| JPEG XL 编码 | ✅ 良好（71.3%） | ✅ 通过 cjxl CLI（80.6%） |
| 维护状态 | ⚠️ 超过一年未更新 | ✅ 活跃开发中 |

**最终选择**: 使用 **Squoosh** 作为 AVIF 编码引擎（显著优于 Sharp），使用 **CLI cjxl** 作为 JPEG XL 编码引擎。Jpegli 因 Homebrew 默认关闭且需复杂编译，暂不作为默认后端。

## 🚀 快速开始

### 下载客户端

从 [Releases](https://github.com/guofeng/octor-compressor/releases) 页面下载对应系统的安装包。

### 从源码运行

```bash
# 克隆仓库
git clone https://github.com/guofeng/octor-compressor.git
cd octor-compressor

# 安装依赖
npm install

# 安装压缩工具 (macOS)
brew install pngquant gifsicle webp oxipng jpeg-xl libavif

# 启动应用
npm start
```

### 启动官网

```bash
npm run website
```

## 📦 打包部署

### 环境要求

- **Node.js ≥ 18**（推荐 v20 LTS）
- **npm ≥ 10**
- **macOS**: Xcode Command Line Tools
- **Windows**: 需在 Windows 环境下打包

> ⚠️ Node.js v14 过旧，无法安装最新依赖。建议使用 nvm 管理 Node 版本：
> ```bash
> nvm install v20.19.5
> nvm use v20.19.5
> ```

### 安装依赖

```bash
npm install
```

`postinstall` 钩子会自动执行 `electron-builder install-app-deps` 编译原生模块。

### 打包命令

| 命令 | 产物 | 说明 |
|------|------|------|
| `npm run dist:mac` | `.dmg` + `.zip` | macOS ARM64 安装包和压缩包 |
| `npm run dist:win` | `.exe` (NSIS) + `.exe` (Portable) | Windows 安装包和便携版 |
| `npm run dist` | 所有平台 | 全平台打包 |
| `npm run pack` | 目录 | 仅打包目录（不生成安装包） |

打包产物输出到 `release/` 目录：

```
release/
├── Octor Compressor-1.1.0-arm64.dmg          # macOS 安装镜像
├── Octor Compressor-1.1.0-arm64.dmg.blockmap # DMG 增量更新映射
├── Octor Compressor-1.1.0-arm64-mac.zip      # macOS 压缩包
├── Octor Compressor-1.1.0-arm64-mac.zip.blockmap
└── mac-arm64/
    └── Octor Compressor.app/                 # 未打包的 .app 目录
```

### 应用图标

应用图标源文件为 `assets/octo-icon.png`（约 986KB），打包时 electron-builder 自动转换为 `icon.icns`（macOS）和 `.ico`（Windows）。

如需更换图标，替换 `assets/octo-icon.png` 后重新打包即可。

### 注意事项

1. **macOS 代码签名**: `package.json` 中 `mac.identity` 设为 `null`，打包跳过签名。如需正式分发，需配置 Apple Developer 证书。
2. **Node.js 版本**: 务必使用 Node.js ≥ 18，推荐 v20 LTS。低版本会导致 `sharp` 等原生模块安装失败。
3. **CLI 压缩工具**: 打包后的应用在用户机器上仍需安装以下 CLI 工具才能使用对应引擎：
   ```bash
   brew install pngquant gifsicle webp oxipng jpeg-xl libavif
   ```
4. **Sharp 模块**: `sharp` 为原生 Node.js 模块，`postinstall` 会在当前架构下自动编译。跨平台打包时需在目标平台上执行。
5. **发布 Release**: 打包完成后，将 `release/` 目录下的 `.dmg`、`.zip` 和 `.blockmap` 文件上传到 GitHub Releases 即可。


## 🏗️ 项目结构

```
octor-compressor/
├── main.js              # Electron 主进程
├── compression/
│   └── engine.js        # 压缩引擎（多后端调度）
├── renderer/
│   ├── index.html       # 主界面
│   ├── style.css        # 样式
│   └── app.js           # 渲染进程逻辑
├── website/
│   └── index.html       # 官网首页
└── package.json
```

## 📄 许可证

[MIT](LICENSE) © Octor Team

## 🙏 致谢

- [Sharp](https://sharp.pixelplumbing.com/) — 高性能 Node.js 图像处理库
- [Squoosh](https://github.com/GoogleChromeLabs/squoosh) — Google 的 WASM 图片压缩引擎
- [pngquant](https://pngquant.org/)
- [mozjpeg](https://github.com/mozilla/mozjpeg)
- [gifsicle](https://www.lcdf.org/gifsicle/)
- [WebP](https://developers.google.com/speed/webp)
- [OxiPNG](https://github.com/shssoichiro/oxipng)
- [JPEG XL](https://jpeg.org/jpegxl/index.html)
- [AVIF](https://aomediacodec.github.io/av1-avif/)
