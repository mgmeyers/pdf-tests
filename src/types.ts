export enum GroupingOptions {
  Tag = "tag",
  AnnotationDate = "annotation-date",
  ExportDate = "export-date",
  Color = "color",
}

export enum SortingOptions {
  Color = "color",
  Date = "date",
  Location = "location",
}

export interface CalloutDef {
  type: string;
  prefix: string;
}

export interface InputParams {
  noWrite: boolean;

  apiKey: string;
  dateFormat: string;
  dateTimeFormat: string;

  calloutPrefixes?: CalloutDef[];
  concatenationPrefix?: string;
  taskPrefix?: string;

  pdfInputPath: string;
  assetOutputPath: string;
  imageDPI: number;

  groupBy: GroupingOptions;
  sortBy: SortingOptions;
  lastExportDate?: number;
}

export const DefaultInputParams: InputParams = {
  noWrite: false,
  dateFormat: 'YYYY-MM-DD',
  dateTimeFormat: 'YYYY-MM-DD HH:mm',
  apiKey: "",
  assetOutputPath: "",
  groupBy: GroupingOptions.ExportDate,
  imageDPI: 100,
  pdfInputPath: "",
  sortBy: SortingOptions.Date,
};

export interface Annotation {
  annotatedText?: string[];
  comment?: string[];
  imagePath?: string[];

  id: string;
  type: string;
  color: string;
  date: number;
  exportDate: number;
  page: number;
  tags: string[];

  isTask: boolean;
  isCallout: boolean;
  calloutType?: string;
}

export interface AnnotationData {
  annotations: Annotation[];
  callouts: Record<string, Annotation[]>;
  groupedAnnotations: Record<string, Annotation[]>;
}
