export type PageSize = "A4" | "Letter" | "fit";

export type Orientation = "auto" | "portrait" | "landscape";

export type Margin = 0 | 20 | 40;

export interface PdfConfig {
  pageSize: PageSize;
  orientation: Orientation;
  margin: Margin;
}
