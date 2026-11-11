import { z } from "zod";
import { ProductSchema, type Product } from "@/domain/schemas";
import rawProducts from "@/data/products.json";

export interface ProductProvider {
  search(query: string): Promise<Product[]>;
  getById(id: string): Promise<Product | null>;
  listAll(): Promise<Product[]>;
}

const STOP_WORDS = new Set(["the", "a", "an", "for", "of", "and", "cheapest", "best", "buy", "get", "me", "under"]);

const validatedCatalog: Product[] = z.array(ProductSchema).parse(rawProducts);

export class LocalProductProvider implements ProductProvider {
  private readonly products: Product[];

  constructor(products: Product[] = validatedCatalog) {
    this.products = products;
  }

  async listAll(): Promise<Product[]> {
    return [...this.products];
  }

  async getById(id: string): Promise<Product | null> {
    return this.products.find((p) => p.id === id) ?? null;
  }

  async search(query: string): Promise<Product[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.listAll();
    }

    const rawTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    const meaningfulTokens = rawTokens.filter((t) => !STOP_WORDS.has(t));
    const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;
    const preferCheapest = /\b(cheap|cheapest|lowest|budget)\b/.test(normalized);

    const scored = this.products
      .map((product) => {
        const title = product.title.toLowerCase();
        const category = product.category.toLowerCase();
        const merchant = product.merchant.toLowerCase();
        const description = product.description.toLowerCase();

        let score = 0;
        for (const token of tokens) {
          if (title.includes(token)) score += 4;
          else if (category.includes(token)) score += 3;
          else if (merchant.includes(token)) score += 2;
          else if (description.includes(token)) score += 1;
        }
        return { product, score };
      })
      .filter((entry) => entry.score > 0);

    scored.sort((a, b) => {
      if (preferCheapest) {
        return a.product.priceCents - b.product.priceCents || b.score - a.score;
      }
      return b.score - a.score || a.product.priceCents - b.product.priceCents;
    });

    return scored.map((entry) => entry.product);
  }
}

