# 生产环境 & 更新方式

> 项目级运维记忆。记录生产部署的访问方式、部署流程和已踩过的坑。

## 生产环境（路由器）

| 项 | 值 |
|----|----|
| SSH | `root@192.168.100.1`（密钥认证；本机 ssh 需 `-F ~/.ssh/config` 绕过 `/etc/ssh/ssh_config.d/` 权限报错） |
| 仓库路径 | `/mnt/data_nvme0n1p4/coding-plan-gateway` |
| 容器 | `coding-plan-gateway`（compose service 名 `gateway`） |
| 镜像 | `coding-plan-gateway:latest` |
| 配置 | bind mount `/mnt/data_nvme0n1p4/coding-plan-gateway/config.yaml` → `/app/config.yaml` |
| 数据卷 | `/mnt/data_nvme0n1p4/docker/volumes/coding-plan-gateway_gateway-data/_data` → `/app/data`（usage-stats / balance-history 持久化，重启不丢） |
| 端口 | `.env` 的 `PORT`，默认 8080；健康检查 `GET /health`，仪表盘 `/dashboard` |
| 余额型 plan | DeepSeek（K线数据在生产）；本机 dev 环境只有 LM Studio + Kimi，`balance-history` 返回空 plans 属正常 |

## 更新流程

```bash
ssh -F ~/.ssh/config root@192.168.100.1
cd /mnt/data_nvme0n1p4/coding-plan-gateway
./cpg update    # fetch → reset --hard origin/master → docker build → 重建容器 → 90s 健康检查，失败自动回滚
```

`cpg update` 行为要点：

- **拉的是 `origin/master`**：本地提交的代码必须先 `git push origin master`，否则部署的是远端旧版本
- 成功后会自动 untag 本次的 `rollback-<sha>` 临时镜像；失败时回滚到 `rollback-<sha>` 镜像并恢复 `config.yaml.pre-update.bak`
- compose 警告 `Found orphan containers (claude-code-e2e, litellm-e2e)` 是 e2e 残留容器，无害
- 部署后验证：
  ```bash
  curl -s http://127.0.0.1:$PORT/health
  curl -s http://127.0.0.1:$PORT/dashboard | grep -o <新功能标记>
  curl -s "http://127.0.0.1:$PORT/api/dashboard/balance-history?hours=24"   # 确认 K线数据还在
  ```

## 镜像清理（更新后）

```bash
docker image prune -f          # 悬空镜像（重建产生的大头）
docker rmi coding-plan-gateway:rollback-*   # 历史更新残留的临时回滚标签
```

2026-08-24 曾一次性清掉 dangling（1.85GB）+ 全部 13 个 `backup-*` 旧备份标签（约 2.1GB，用户确认删除）。之后每次更新只会有 dangling 和偶发 `rollback-*` 残留。

## 已踩过的坑

1. **`.git/config` 丢失 fetch refspec 会导致 `cpg update` 部署陈旧版本**（2026-08-24 本机实测）：
   没有 `fetch = +refs/heads/*:refs/remotes/origin/*` 时，`git fetch origin master` 只更新 FETCH_HEAD，
   本地 `origin/master` 永远停在旧值，而脚本 `reset --hard origin/master` 就会回退到陈旧代码。
   排查命令：`git config --get remote.origin.fetch`（生产机正常，本机曾缺失）。
   修复：`git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`。
2. 沙箱环境跑 `./cpg update` 会因 `~/.docker/buildx` 只读而 build 失败并触发回滚脚本——属环境限制，非脚本问题。
