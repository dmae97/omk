import { native } from "./native";
import type { SearchDb as NativeSearchDb, SearchDbConstructor } from "./search-db-types";

export const SearchDb = native.SearchDb as SearchDbConstructor;

export type { SearchDbConstructor };
export type SearchDb = NativeSearchDb;
