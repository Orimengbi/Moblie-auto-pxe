import https from "node:https";
import type { Duplex } from "node:stream";
import type tls from "node:tls";
import { db } from "./db.ts";

/**
 * BMC 用自签证书，没法按 CA 校验。这里改成「第一次连上时记住证书指纹」（TOFU）：
 * 以后指纹变了就在发出任何数据（包括 Basic 认证的账号密码）之前断开，
 * 等有「BMC 设置」权限的人在资产页确认后再接受新证书。BMC 恢复出厂、刷固件可能换证书，这时要去点一下。
 */

export class BmcCertChanged extends Error {
  readonly endpoint: string;
  constructor(endpoint: string, was: string, now: string) {
    super(`BMC ${endpoint} 的证书变了（原来 ${short(was)}，现在 ${short(now)}），可能被冒充，没有连接。确认是这台 BMC 换了证书后，到资产页的 BMC 证书里点「信任新证书」`);
    this.endpoint = endpoint;
  }
}

export interface BmcCert {
  endpoint: string;
  fingerprint: string;
  subject: string;
  validTo: string;
  firstSeen: string;
  /** 最近一次被拒的新指纹，没有就是空。 */
  seenFingerprint: string;
  seenAt: string;
}

function short(fingerprint: string): string {
  return fingerprint.slice(0, 23);
}

export function endpointOf(host: string, port: number | string): string {
  return `${host}:${port}`;
}

/** 这台 BMC 网页端口对应的记录名。端口只有测试会改。 */
export function bmcEndpoint(host: string): string {
  return endpointOf(host, Number(process.env.PXE_KVM_BMC_PORT || 443));
}

function rowToCert(row: Record<string, unknown>): BmcCert {
  return {
    endpoint: String(row.endpoint),
    fingerprint: String(row.fingerprint),
    subject: String(row.subject),
    validTo: String(row.valid_to),
    firstSeen: String(row.first_seen),
    seenFingerprint: String(row.seen_fingerprint),
    seenAt: String(row.seen_at),
  };
}

export function getBmcCert(endpoint: string): BmcCert | null {
  const row = db().prepare("SELECT * FROM bmc_certs WHERE endpoint = ?").get(endpoint);
  return row ? rowToCert(row) : null;
}

/** 核对这次连接拿到的证书；第一次见就记下。对不上时记下新指纹（给页面看）并返回错误。 */
export function checkBmcCert(endpoint: string, cert: tls.PeerCertificate | null | undefined): Error | null {
  const fingerprint = cert?.fingerprint256 || "";
  if (!fingerprint) return new Error(`BMC ${endpoint} 没有给出证书`);
  const known = getBmcCert(endpoint);
  if (!known) {
    db()
      .prepare("INSERT OR IGNORE INTO bmc_certs (endpoint, fingerprint, subject, valid_to, first_seen) VALUES (?, ?, ?, ?, ?)")
      .run(endpoint, fingerprint, subjectOf(cert), cert?.valid_to || "", new Date().toISOString());
    // 两个连接同时第一次连时，以先写进去的为准。
    const stored = getBmcCert(endpoint);
    return stored && stored.fingerprint !== fingerprint ? new BmcCertChanged(endpoint, stored.fingerprint, fingerprint) : null;
  }
  if (known.fingerprint === fingerprint) return null;
  if (known.seenFingerprint !== fingerprint) {
    db().prepare("UPDATE bmc_certs SET seen_fingerprint = ?, seen_at = ? WHERE endpoint = ?").run(fingerprint, new Date().toISOString(), endpoint);
  }
  return new BmcCertChanged(endpoint, known.fingerprint, fingerprint);
}

function subjectOf(cert: tls.PeerCertificate | null | undefined): string {
  const subject = cert?.subject as unknown as Record<string, string | string[]> | undefined;
  if (!subject) return "";
  return Object.entries(subject)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("+") : value}`)
    .join(", ")
    .slice(0, 300);
}

/** 接受最近一次被拒的新证书。没有被拒过就什么都不做，返回 false。 */
export function trustSeenBmcCert(endpoint: string): boolean {
  const known = getBmcCert(endpoint);
  if (!known?.seenFingerprint) return false;
  db()
    .prepare("UPDATE bmc_certs SET fingerprint = seen_fingerprint, subject = '', valid_to = '', first_seen = ?, seen_fingerprint = '', seen_at = '' WHERE endpoint = ?")
    .run(new Date().toISOString(), endpoint);
  return true;
}

/** 忘掉记下的证书，下次连接重新记。BMC 改了 IP、旧地址给了别的机器时用。 */
export function forgetBmcCert(endpoint: string): void {
  db().prepare("DELETE FROM bmc_certs WHERE endpoint = ?").run(endpoint);
}

/**
 * 连 BMC 用的 Agent：TLS 握手完、核对过证书指纹才把连接交给 http，所以对不上时请求一个字节都不会发出去。
 * 证书本身不按 CA 校验（自签），靠指纹。
 */
export class BmcAgent extends https.Agent {
  constructor(options: https.AgentOptions = {}) {
    // 不复用 TLS 会话：复用握手时不一定拿得到证书，指纹就核不了。
    super({ ...options, rejectUnauthorized: false, maxCachedSessions: 0 });
  }

  createConnection(options: https.RequestOptions, callback?: (error: Error | null, stream: Duplex) => void): undefined {
    const socket = (https.Agent.prototype as unknown as { createConnection: (o: unknown) => tls.TLSSocket }).createConnection.call(this, options);
    const endpoint = endpointOf(String(options.host || options.hostname || ""), Number(options.port || 443));
    let done = false;
    // 握手完才把连接交给 http，请求上的 timeout 管不到连接这一段。BMC 不回时不能等系统的 TCP 超时（两分钟以上），自己限时。
    const timer = setTimeout(() => finish(new Error("连 BMC 超时")), Number(options.timeout) || 20_000);
    const finish = (error: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off("error", onError);
      if (error) socket.destroy();
      callback?.(error, socket);
    };
    const onError = (error: Error) => finish(error);
    socket.once("error", onError);
    socket.once("secureConnect", () => {
      let error: Error | null;
      try {
        error = checkBmcCert(endpoint, socket.getPeerCertificate());
      } catch (cause) {
        error = cause instanceof Error ? cause : new Error("核对 BMC 证书失败");
      }
      finish(error);
    });
    return undefined;
  }
}
