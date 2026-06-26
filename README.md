# 🐙 Octoman Compressor

> **PP鸭 的完全免费开源复刻版** — 图片压缩神器，帮你的图片减减肥

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/guofeng/octoman-compressor/releases)

## 📸 截图

![Octoman Compressor](website/screenshot.png)

## ✨ 特性

- 🎯 **智能算法选择** — 自动分析图片特征，从 pngquant、mozjpeg、gifsicle、cwebp 中选择最优算法
- 📦 **批量处理** — 支持批量选择图片或拖入整个文件夹，自动递归处理子目录
- 🔄 **多种格式** — 支持 PNG、JPG、GIF、WebP、BMP 格式压缩
- 📊 **实时对比** — 压缩前后体积、压缩率一目了然
- 🔓 **完全免费** — MIT 开源协议，无需购买激活码
- 🖥️ **桌面应用** — 基于 Electron 构建，原生体验

## 🚀 快速开始

### 下载客户端

从 [Releases](https://github.com/guofeng/octoman-compressor/releases) 页面下载对应系统的安装包。

### 从源码运行

```bash
# 克隆仓库
git clone https://github.com/guofeng/octoman-compressor.git
cd octoman-compressor

# 安装依赖
npm install

# 安装压缩工具 (macOS)
brew install pngquant mozjpeg gifsicle webp

# 启动应用
npm start
```

### 启动官网

```bash
npm run website
```

## 🧩 压缩算法

| 格式 | 算法 | 说明 |
|------|------|------|
| PNG | [pngquant](https://pngquant.org/) | 有损压缩，可减少 50-70% 体积 |
| JPG | [mozjpeg](https://github.com/mozilla/mozjpeg) | Mozilla 优化的 JPEG 编码器 |
| GIF | [gifsicle](https://www.lcdf.org/gifsicle/) | GIF 优化压缩 |
| WebP | [cwebp](https://developers.google.com/speed/webp) | Google WebP 编码器 |

## 🏗️ 项目结构

```
octoman-compressor/
├── main.js              # Electron 主进程
├── compression/
│   └── engine.js        # 压缩引擎（算法调度）
├── renderer/
│   ├── index.html       # 主界面
│   ├── style.css        # 样式
│   └── app.js           # 渲染进程逻辑
├── website/
│   └── index.html       # 官网首页
└── package.json
```

## 📄 许可证

[MIT](LICENSE) © Octoman Team

## 🙏 致谢

- [PP鸭](https://ppduck.com/) — 优秀的图片压缩工具，本项目的灵感来源
- [pngquant](https://pngquant.org/)
- [mozjpeg](https://github.com/mozilla/mozjpeg)
- [gifsicle](https://www.lcdf.org/gifsicle/)
- [WebP](https://developers.google.com/speed/webp)
