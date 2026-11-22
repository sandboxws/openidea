import { create } from "zustand";
import type { TomlSection } from "../sections";

interface FindSection {
  path: string | null;
  sections: TomlSection[];
}

export const useFindSection = create<FindSection>(() => ({ path: null, sections: [] }));

export const openFindSection = (path: string, sections: TomlSection[]) => useFindSection.setState({ path, sections });
export const closeFindSection = () => useFindSection.setState({ path: null, sections: [] });
