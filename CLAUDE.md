# 运维约束（PXE 装机系统，仓库 Orimengbi/Moblie-auto-pxe）

本机通过 docker compose 部署，只有三个容器：
mobile-auto-pxe-console-1、mobile-auto-pxe-boot-1、mobile-auto-pxe-dnsmasq-1。

硬性约束：
- 只允许操作这三个容器和它们所在的 compose 项目，不要动其他容器、镜像、宿主机网络配置和防火墙。
- 装机网口是 enp5s0d1。
- 任何改动前先把部署目录下的 data/ 备份到 /root/pxe-data-backup-<时间>。
- 每一步执行前先告诉用户要做什么。
