import Link from "next/link";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export default function NotFound() {
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="h2">没有这个页面</Typography>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        地址不对，或者要找的东西已经删掉了。
      </Typography>
      <Button component={Link} href="/" variant="outlined">
        回到总览
      </Button>
    </Stack>
  );
}
