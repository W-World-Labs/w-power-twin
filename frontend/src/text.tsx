import type { Lang, Text } from "./types";

export function label(t: Text, lang: Lang): string {
  if (lang === "zh") return t.zh;
  if (lang === "en") return t.en;
  return `${t.zh} · ${t.en}`;
}

export function Bi({ t, lang }: { t: Text; lang: Lang }) {
  if (lang !== "both") return <>{t[lang]}</>;
  return (
    <>
      <span lang="zh-CN">{t.zh}</span>
      <span className="secondary" lang="en">
        {t.en}
      </span>
    </>
  );
}
