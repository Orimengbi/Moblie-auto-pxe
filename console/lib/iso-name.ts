/** 可以导入的镜像后缀。压缩过的 ISO 在抽取任务里先解压成 source.iso。 */
export const ISO_SUFFIXES = [".iso", ".iso.xz", ".iso.gz", ".iso.zst", ".iso.bz2"] as const;

export type IsoSuffix = (typeof ISO_SUFFIXES)[number];

export const ISO_ACCEPT = ISO_SUFFIXES.join(",");

export const ISO_FORMATS_LABEL = ".iso、.iso.xz、.iso.gz、.iso.zst、.iso.bz2";

/** 返回文件名的 ISO 后缀；不是可导入的镜像返回 null。最长的后缀先匹配。 */
export function isoSuffix(filename: string): IsoSuffix | null {
  const lower = filename.toLowerCase();
  return [...ISO_SUFFIXES].sort((a, b) => b.length - a.length).find((suffix) => lower.endsWith(suffix)) || null;
}

export function stripIsoSuffix(filename: string): string {
  const suffix = isoSuffix(filename);
  return suffix ? filename.slice(0, -suffix.length) : filename;
}
