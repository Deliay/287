import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NextConfig } from "next";

const root = process.cwd();

/** 读取仓库根目录下的文本文件 */
function readRootFile(fileName: string): string {
  return readFileSync(path.join(root, fileName), "utf8");
}

/**
 * 解析本项目 wrangler.toml 的扁平结构（顶层键值对 + 单个 [assets] 表）。
 * 返回「表名 → 字段名 → 值」，顶层字段归入空表名 ""。
 */
function parseFlatToml(source: string): Record<string, Record<string, string>> {
  const tables: Record<string, Record<string, string>> = { "": {} };
  let current = "";
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1].trim();
      tables[current] ??= {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    tables[current] ??= {};
    tables[current][kv[1]] = value;
  }
  return tables;
}

describe("部署配置一致性 deploy-config", () => {
  it("wrangler.toml 存在：name 非空、assets.directory 指向 ./out、顶层字段白名单且不含任何密钥", () => {
    const filePath = path.join(root, "wrangler.toml");
    expect(existsSync(filePath), "仓库根目录应存在 wrangler.toml").toBe(true);

    const tables = parseFlatToml(readRootFile("wrangler.toml"));
    const topLevel = tables[""];

    expect(typeof topLevel.name).toBe("string");
    expect(topLevel.name.length).toBeGreaterThan(0);
    expect(tables.assets?.directory).toBe("./out");

    // 字段白名单：顶层仅允许 name / compatibility_date，表仅允许 assets
    expect(Object.keys(topLevel).sort()).toEqual(["compatibility_date", "name"]);
    expect(Object.keys(tables).filter((t) => t !== "").sort()).toEqual(["assets"]);

    // 密钥零容忍：任何键名不得出现敏感字样
    const sensitive = /token|secret|password|api[_-]?key|private/i;
    for (const [table, fields] of Object.entries(tables)) {
      for (const key of Object.keys(fields)) {
        expect(
          sensitive.test(`${table}.${key}`),
          `${table}.${key} 不应出现敏感字段名`,
        ).toBe(false);
      }
    }
  });

  it("package.json 提供 deploy（wrangler deploy）与 preview（wrangler dev）脚本", () => {
    const pkg = JSON.parse(readRootFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.deploy).toContain("wrangler deploy");
    expect(pkg.scripts?.preview).toContain("wrangler dev");
  });

  it("package.json 的 devDependencies 包含 wrangler", () => {
    const pkg = JSON.parse(readRootFile("package.json")) as {
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.devDependencies ?? {})).toContain("wrangler");
  });

  it("next.config.ts 默认导出为静态导出配置（output: export + images.unoptimized）", async () => {
    const mod = (await import("../next.config")) as { default: NextConfig };
    const config = mod.default;
    expect(config.output).toBe("export");
    expect(config.images?.unoptimized).toBe(true);
  });
});
