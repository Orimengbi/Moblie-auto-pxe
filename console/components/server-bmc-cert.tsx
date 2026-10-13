"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { BmcCert } from "@/lib/bmc-tls";
import { api } from "@/lib/client-api";
import { formatTime } from "@/lib/time";

const MONO = '"SF Mono", ui-monospace, var(--font-geist-mono), monospace';

/** BMC 的 HTTPS 证书：第一次连上时记下指纹，以后变了控制台就不连，在这里确认。 */
export function BmcCertSection({ assetId, canEdit, onChanged }: { assetId: string; canEdit: boolean; onChanged: () => void }) {
  const [cert, setCert] = useState<BmcCert | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await api<{ cert: BmcCert | null }>(`/api/assets/${assetId}/bmc-cert`);
    if (result.ok) setCert(result.data.cert);
    else setError(result.error);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "trust" | "forget") {
    const prompt =
      action === "trust"
        ? "确认这台 BMC 确实换了证书（恢复出厂、刷固件、换了主板）？确认后控制台会接受新证书。"
        : "忘掉记下的证书？下次连接时不管对方是谁都会重新记下。只在 BMC 换了 IP、旧地址给了别的机器时用。";
    if (!window.confirm(prompt)) return;
    setBusy(true);
    const result = await api<{ message: string; cert: BmcCert | null }>(`/api/assets/${assetId}/bmc-cert`, "POST", { action });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setMessage(result.data.message);
    setCert(result.data.cert);
    onChanged();
  }

  if (cert === undefined && !error) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        BMC 证书
      </Typography>
      <Stack spacing={1}>
        {cert?.seenFingerprint ? (
          <Alert
            severity="error"
            action={
              canEdit ? (
                <Button color="inherit" size="small" disabled={busy} onClick={() => void act("trust")}>
                  信任新证书
                </Button>
              ) : null
            }
          >
            {formatTime(cert.seenAt)} 这台 BMC 给出了另一张证书，控制台没有连接（可能被冒充）。确认是 BMC 自己换了证书后再信任。
            <Typography component="div" variant="caption" sx={{ fontFamily: MONO, wordBreak: "break-all", mt: 0.5 }}>
              新：{cert.seenFingerprint}
            </Typography>
          </Alert>
        ) : null}
        {cert ? (
          <>
            <Typography variant="caption" sx={{ fontFamily: MONO, wordBreak: "break-all" }}>
              SHA-256 {cert.fingerprint}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {formatTime(cert.firstSeen)} 起记下
              {cert.subject ? `，${cert.subject}` : ""}
              {cert.validTo ? `，有效期到 ${cert.validTo}` : ""}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            还没连过，第一次连接时记下。
          </Typography>
        )}
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
        {message ? (
          <Typography variant="body2" sx={{ color: "success.main" }}>
            {message}
          </Typography>
        ) : null}
        {canEdit && cert ? (
          <Stack direction="row">
            <Button size="small" disabled={busy} onClick={() => void act("forget")}>
              忘掉，重新记
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
