# 离线安装和升级

正式环境不通外网。版本在能上网的机器上打成一个 `.run` 文件，拷过去执行，或在控制台上传。

## 打包（能上网的机器）

```sh
git checkout main && git pull
release/build-release.sh --with-docker   # 首次安装包 pxe-<版本>-full.run，带静态版 Docker，约 280 MB
release/build-release.sh                 # 升级包 pxe-<版本>.run，约 170 MB
```

包放在 `/var/tmp/pxe-releases/`。打包脚本会先跑单元测试，再按「日期-提交号」构建三个镜像，最后用发布密钥签名。

- 私钥在 `~/.config/pxe-release/release-key.pem`，不进仓库，要另外备份。私钥丢了，打出来的包正式机不认，只能在正式机上手工换 `/opt/pxe/release.pub`。
- 公钥是 `release/release.pub`，装机时会放到正式机上。

## 首次安装（正式机）

要求 x86_64、systemd。没装 Docker 时用 `-full` 包，包里的静态版 Docker 不挑系统版本。

先把装机网口配成静态地址，然后执行：

```sh
sudo bash pxe-<版本>-full.run
```

安装时会问三件事：管理口地址（控制台监听在这里）、装机网口和它的地址、HTTP 端口（默认 8080）。也可以直接在命令行给出：

```sh
sudo bash pxe-<版本>-full.run --mgmt-ip 10.0.0.5 --install-if eno2 --install-ip 192.168.77.1/24 --port 8080 --yes
```

装好后会打印控制台地址和 admin 的初始密码。程序装在 `/opt/pxe`，命令行工具是 `pxectl`。

## 升级

两种方式，效果一样：

- **网页**：在「备份和升级」页上传 `pxe-<版本>.run`，点「升级」。
- **命令行**：`sudo bash pxe-<版本>.run`，或 `sudo pxectl upgrade pxe-<版本>.run`。

升级的步骤：

1. 核对校验和、验签。
2. 等正在跑的任务和镜像解包结束。
3. 导入镜像。
4. 自动备份数据和配置。
5. 换上新版本。
6. 检查新版本能不能打开。新版本 4 分钟内起不来，就自动回到原版本，并恢复升级前的数据。

整个过程控制台大约断开半分钟。

网页升级时，控制台本身不碰 Docker。它只把包存进 `data/system/updates/`，再写一个请求文件；宿主机上的 `pxe-update.path`（systemd）看到请求后调用 `pxectl` 执行升级。签名不对的包会被拒绝。

## 常用命令

```sh
pxectl status                    # 版本、地址、容器、最近一次升级
pxectl rollback [--with-data]    # 回到上一个版本；--with-data 同时恢复升级前的数据
pxectl backup [--full]           # 备份到 /opt/pxe/data/backups
pxectl list-backups
pxectl restore <备份文件>         # 也可以是从别处拷来的 .tar.zst
pxectl reconfigure               # 改管理口、装机网口、端口
pxectl reset-password admin
pxectl logs console
```

## 备份

- **数据和配置**：数据库（用 VACUUM INTO 拍的一致快照）、采集记录、装机批次、模板、SSH 密钥等，几十 MB。
- **完整**：再加上镜像、固件包、诊断包，用来整机搬家。

备份里有账号、BMC 密码和私钥，文件权限是 0600，要妥善保管。恢复前会自动备份一份现在的数据。恢复「数据和配置」备份时，现有的镜像不动。
