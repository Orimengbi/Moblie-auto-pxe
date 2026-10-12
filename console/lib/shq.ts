/**
 * 给 sh 用的单引号转义：整个包进单引号，里面的单引号写成 '\''。
 * 拼进 sh -c、远程命令、装机脚本的值都过这一个，别再各写一份。
 */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
