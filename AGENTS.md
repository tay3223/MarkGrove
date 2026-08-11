# AGENTS.md

本文件定义 AI 代理在本仓库中工作时必须遵守的规则。任何 AI 在开始工作前必须先阅读并严格执行本文件。

## 1. 禁止任何形式的 AI 进行任何形式的 Git "写操作"

**这是最高优先级的红线规则，没有任何例外，也不接受任何"顺手帮忙"式的变通。**

AI 禁止执行一切会改变本地仓库状态、暂存区、提交历史或远程仓库的 Git 操作，包括但不限于：

- `git add` / `git rm` / `git mv`（暂存与删除跟踪）
- `git commit`（含 `--amend`）
- `git push`（含 `--force` / `-f`）
- `git merge` / `git rebase` / `git cherry-pick` / `git revert`
- `git reset` / `git restore --staged` / `git checkout <分支>` / `git switch`
- `git branch` 的创建与删除、`git tag` 的创建与删除、`git stash`
- 通过脚本、子进程、MCP 工具或其他任何间接方式完成的上述等价操作

AI **只允许**执行只读 Git 命令，例如：`git status`、`git log`、`git diff`、`git show`、`git branch -l`、`git remote -v`、`git ls-remote`。

所有提交、推送、分支管理等写操作一律由用户本人手动完成。AI 可以修改工作区文件、可以生成建议的提交信息和完整命令文本供用户复制执行，但绝不能代为执行。
