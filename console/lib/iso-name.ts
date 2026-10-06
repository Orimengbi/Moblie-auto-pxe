/**
 * 可以导入的镜像后缀。压缩过的在抽取任务里先解压成 source.iso。
 * .img 是 dd 导出的整盘镜像，按内容识别，存的时候和 ISO 一样叫 source.iso。
 */
export const ISO_SUFFIXES = [".iso", ".iso.xz", ".iso.gz", ".iso.zst", ".iso.bz2", ".img", ".img.xz", ".img.gz", ".img.zst", ".img.bz2"] as const;

export type IsoSuffix = (typeof ISO_SUFFIXES)[number];

export const ISO_ACCEPT = ISO_SUFFIXES.join(",");

export const ISO_FORMATS_LABEL = ".iso、.img 以及它们的 .xz、.gz、.zst、.bz2 压缩包";

/** 镜像目录里存成什么后缀：.img 一律当 .iso 存，抽取任务只认 source.iso*。 */
export function storedSuffix(suffix: IsoSuffix): string {
  return suffix.replace(/^\.img/, ".iso");
}

/** 返回文件名的 ISO 后缀；不是可导入的镜像返回 null。最长的后缀先匹配。 */
export function isoSuffix(filename: string): IsoSuffix | null {
  const lower = filename.toLowerCase();
  return [...ISO_SUFFIXES].sort((a, b) => b.length - a.length).find((suffix) => lower.endsWith(suffix)) || null;
}

export function stripIsoSuffix(filename: string): string {
  const suffix = isoSuffix(filename);
  return suffix ? filename.slice(0, -suffix.length) : filename;
}
