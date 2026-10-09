import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/** 页面标题。actions 放在右边（新建、导入之类的按钮）。 */
export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3, alignItems: { sm: "flex-end" }, justifyContent: "space-between" }}>
      <Box sx={{ maxWidth: 760 }}>
        <Typography variant="h1">{title}</Typography>
        {description ? (
          <Typography variant="body2" sx={{ mt: 0.75, color: "text.secondary", lineHeight: 1.7 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {actions ? <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: "wrap", rowGap: 1 }}>{actions}</Stack> : null}
    </Stack>
  );
}
