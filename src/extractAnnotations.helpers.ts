import { PDFNet } from "@pdftron/pdfnet-node";
import moment from 'moment';
import {
  Annotation,
  CalloutDef,
  GroupingOptions,
  InputParams,
  SortingOptions,
} from "./types";
import fs from "fs";
import path from "path";

export function escapeStringRegexp(string: string) {
  if (typeof string !== "string") {
    throw new TypeError("Expected a string");
  }
  return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

function componentToHex(c: number) {
  var hex = c.toString(16);
  return hex.length == 1 ? "0" + hex : hex;
}

export function rgbToHex(r: number, g: number, b: number) {
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

export async function getColor(colorPt: PDFNet.ColorPt) {
  const r = Math.round((await colorPt.get(0)) * 255);
  const g = Math.round((await colorPt.get(1)) * 255);
  const b = Math.round((await colorPt.get(2)) * 255);

  return rgbToHex(r, g, b);
}

export function getAnnoteDisplayType(type: number) {
  switch (type) {
    case PDFNet.Annot.Type.e_Text:
      return "note";
    case PDFNet.Annot.Type.e_Underline:
      return "underline";
    case PDFNet.Annot.Type.e_Highlight:
      return "highlight";
    case PDFNet.Annot.Type.e_StrikeOut:
      return "strikethrough";
    case PDFNet.Annot.Type.e_Square:
      return "image";
    default:
      return null;
  }
}

export function getImageName(
  PDFBaseName: string,
  pageIndex: number,
  annotIndex: number
) {
  return `${PDFBaseName}-p${pageIndex}-a${annotIndex}.png`;
}

export function getTags(comment: string) {
  return comment
    .split(/[\s\n\r]/gim)
    .filter((v) => v.startsWith("#"))
    .map((v) => v.replace(/^#+/, ""));
}

export function isTask(taskPrefix: string, comment: string) {
  return taskPrefix ? new RegExp(`^${escapeStringRegexp(taskPrefix)}`, "i").test(comment) : false;
}

export function getCalloutType(calloutPrefixes: CalloutDef[], comment: string) {
  return calloutPrefixes.find((c) =>
    new RegExp(`^${escapeStringRegexp(c.prefix)}`, "i").test(comment)
  );
}

export function sortAnnotations(
  inputParams: InputParams,
  annotations: Annotation[]
) {
  switch (inputParams.sortBy) {
    case SortingOptions.Location:
      break;
    case SortingOptions.Date:
      annotations.sort((a, b) => a.date - b.date);
      break;
    case SortingOptions.Color:
      annotations.sort((a, b) => {
        if (a.color < b.color) return -1;
        if (b.color < a.color) return 1;
        return 0;
      });
      break;
  }

  return annotations;
}

export function groupAnnotations(
  inputParams: InputParams,
  annotations: Annotation[]
): Record<string, Annotation[]> {
  let grouppedAnnots: Record<string, Annotation[]> = {};
  const groupBy = inputParams.groupBy;

  if (groupBy === GroupingOptions.ExportDate) {
    grouppedAnnots = annotations.reduce<Record<string, Annotation[]>>(
      (groupped, current) => {
        const date = moment(current.exportDate).format(inputParams.dateTimeFormat);

        if (groupped[date]) {
          groupped[date].push(current);
        } else {
          groupped[date] = [current];
        }

        return groupped;
      },
      {}
    );
  }

  if (groupBy === GroupingOptions.Color) {
    grouppedAnnots = annotations.reduce<Record<string, Annotation[]>>(
      (groupped, current) => {
        if (groupped[current.color]) {
          groupped[current.color].push(current);
        } else {
          groupped[current.color] = [current];
        }

        return groupped;
      },
      {}
    );
  }

  if (groupBy === GroupingOptions.Tag) {
    grouppedAnnots = annotations.reduce<Record<string, Annotation[]>>(
      (groupped, current) => {
        const tag = current.tags.length ? current.tags[0] : "none";

        if (groupped[tag]) {
          groupped[tag].push(current);
        } else {
          groupped[tag] = [current];
        }

        return groupped;
      },
      {}
    );
  }

  if (groupBy === GroupingOptions.AnnotationDate) {
    grouppedAnnots = annotations.reduce<Record<string, Annotation[]>>(
      (groupped, current) => {
        const date = moment(current.exportDate).format(inputParams.dateFormat);

        if (groupped[date]) {
          groupped[date].push(current);
        } else {
          groupped[date] = [current];
        }

        return groupped;
      },
      {}
    );
  }

  Object.keys(grouppedAnnots).forEach((k) => {
    sortAnnotations(inputParams, grouppedAnnots[k]);
  });

  return grouppedAnnots;
}

export function groupCallouts(
  inputParams: InputParams,
  annotations: Annotation[]
) {
  const grouppedAnnots = annotations.reduce<Record<string, Annotation[]>>(
    (groupped, current) => {
      const type = current.calloutType;

      if (!type) return groupped;

      if (groupped[type]) {
        groupped[type].push(current);
      } else {
        groupped[type] = [current];
      }

      return groupped;
    },
    {}
  );

  Object.keys(grouppedAnnots).forEach((k) => {
    sortAnnotations(inputParams, grouppedAnnots[k]);
  });

  return grouppedAnnots;
}

export async function exportImage(params: {
  assetPath: string;
  baseName: string;
  draw: PDFNet.PDFDraw;
  annot: PDFNet.SquareAnnot;
  page: PDFNet.Page;
  pageIndex: number;
  annotIndex: number;
}) {
  const { assetPath, baseName, draw, annot, page, pageIndex, annotIndex } =
    params;
  const rect = await annot.getRect();

  if (!fs.existsSync(assetPath)) {
    fs.mkdirSync(assetPath, { recursive: true });
  }

  await draw.setClipRect(rect);
  await draw.export(
    page,
    path.resolve(assetPath, getImageName(baseName, pageIndex, annotIndex)),
    "PNG"
  );
}

export async function buildAnnotation(
  annot: PDFNet.Annot,
  annotType: number
): Promise<
  | PDFNet.TextAnnot
  | PDFNet.UnderlineAnnot
  | PDFNet.HighlightAnnot
  | PDFNet.StrikeOutAnnot
  | PDFNet.SquareAnnot
> {
  switch (annotType) {
    case PDFNet.Annot.Type.e_Text:
      return await PDFNet.TextAnnot.createFromAnnot(annot);
    case PDFNet.Annot.Type.e_Underline:
      return await PDFNet.UnderlineAnnot.createFromAnnot(annot);
    case PDFNet.Annot.Type.e_Highlight:
      return await PDFNet.HighlightAnnot.createFromAnnot(annot);
    case PDFNet.Annot.Type.e_StrikeOut:
      return await PDFNet.StrikeOutAnnot.createFromAnnot(annot);
    case PDFNet.Annot.Type.e_Square:
      return await PDFNet.SquareAnnot.createFromAnnot(annot);
    default:
      return null;
  }
}

export async function getAnnotationDate(
  annot:
    | PDFNet.TextAnnot
    | PDFNet.UnderlineAnnot
    | PDFNet.HighlightAnnot
    | PDFNet.StrikeOutAnnot
    | PDFNet.SquareAnnot
) {
  const dateObj = await annot.getDate();
  const date = new Date();

  date.setFullYear(dateObj.year);
  date.setMonth(dateObj.month - 1);
  date.setDate(dateObj.day);
  date.setHours(dateObj.hour);
  date.setMinutes(dateObj.minute);
  date.setSeconds(dateObj.second);

  return date;
}
