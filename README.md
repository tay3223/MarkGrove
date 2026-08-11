# MarkGrove · 墨林

> See the forest in your Markdown.

**MarkGrove（中文名：墨林）** 是一款本地优先的 Markdown 可视化与编辑桌面工具。它把长期积累的 Markdown 文档转换为可交互脑图，帮你重新看清文档的结构。

Markdown 是树，积累起来，便是一片墨林。

## 功能特性

- 打开本地目录作为项目，自动扫描 Markdown 文件
- 在原文、渲染预览和脑图之间快速切换
- 在脑图中新增、编辑、删除和拖拽节点，自动同步回 Markdown
- 将代码块收纳为叶节点，在侧边栏查看完整高亮代码
- 支持多项目、文件树和会话恢复
- 监听本地文件变更，自动刷新已打开文档
- 数据保留在本地，无需导入或上传知识库

## 开发环境

- Node.js 20 或更高版本
- npm 10 或更高版本
- macOS、Windows 或 Linux

```bash
npm install
npm run dev
```

## 常用命令

```bash
# TypeScript 类型检查
npm run typecheck

# 构建渲染进程
npm run build

# 打包 Electron 应用
npm run dist
```

## 技术栈

- Electron 35
- React 19
- TypeScript
- Vite 6
- Mind Elixir
- Monaco Editor
- Zustand

## 项目结构

```text
electron/    Electron 主进程与预加载脚本
src/         React 渲染进程
  components/  界面与功能组件
  stores/      应用状态
  utils/       Markdown 与脑图数据转换
```

## 当前状态

MarkGrove 仍处于早期开发阶段。如果你准备用它编辑重要文档，建议先使用版本控制或其他方式做好备份。
