# 运维约束（PXE 装机系统 Union，仓库 Orimengbi/Moblie-auto-pxe）

本机通过 docker compose 部署，只有三个容器：
mobile-auto-pxe-console-1、mobile-auto-pxe-boot-1、mobile-auto-pxe-dnsmasq-1。

2026-10-15 起和正式环境一样用安装包部署（release/README.md）：
- 装在 /opt/pxe，数据在 /opt/pxe/data，管理命令 pxectl。compose 项目名沿用 mobile-auto-pxe（/opt/pxe/site.env 的 PROJECT_NAME）。
- nginx.conf 由 pxectl 按 /opt/pxe/site.env 生成，仓库里的 deploy/nginx/nginx.conf 在本机已经不用。
- 部署新代码：bash /var/tmp/pxe-deploy.sh（从 main 打包，再 pxectl upgrade：自动备份、失败自动回滚）。
- /opt/mobile-auto-pxe 是迁移前的旧部署目录，只剩代码，不再使用。

硬性约束：
- 只允许操作这三个容器和它们所在的 compose 项目，不要动其他容器、镜像、宿主机网络配置和防火墙。
- 装机网口是 enp5s0d1（在网桥 br1 里，装机地址 192.168.77.1/24）。
- 任何改动前先把 /opt/pxe/data/ 备份到 /root/pxe-data-backup-<时间>。
- 每一步执行前先告诉用户要做什么。
