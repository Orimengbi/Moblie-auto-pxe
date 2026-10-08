import { cn } from "cn";

/** 原生下拉框，样式和 Input 一致。选项少、要能直接用 value/onChange 的地方用它。 */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn("h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm", className)} {...props} />;
}
