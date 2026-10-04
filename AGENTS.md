# AGENTS.md — dsh-scholarflow 代码仓库

本目录是 **ScholarFlow** 项目的代码仓库，由 git 追踪，并已连接 GitHub 远端。

## 仓库信息

- 远端：<https://github.com/Favio8/dsh-scholarflow.git>（`origin`）
- 主分支：`main`（跟踪 `origin/main`）
- 仓库定位：本目录只放代码，是项目唯一的源码仓库。

## 核心规则

### 规则一：本目录负责代码，不负责文档

- 本目录（`dsh-scholarflow/`）用于存放项目源代码、脚本、配置与测试。
- **PRD 等开发过程中的设计文档不放这里**，统一放在上一级目录 `../`（即 `dsh-scholarflow-ai/`），参见该目录的 `AGENTS.md`。
- 仅当文档是代码仓库自身必需的说明（如 `README.md`、`docs/` 下的开发/部署说明）时，才随代码一同提交。

### 规则二：git 使用规范

- 所有代码改动都应通过 git 提交，保持 `main` 分支与远端同步（`git push`）。
- 提交信息使用英文，遵循 `emoji type: description` 格式，例如：`✨ feat: add personalized recommendations`。
- 常用 type：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`。
- 提交前先确认工作区状态（`git status`、`git diff`），不提交构建产物、依赖目录与密钥文件。
