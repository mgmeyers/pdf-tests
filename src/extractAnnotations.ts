import { PDFNet } from "@pdftron/pdfnet-node";
import moment from "moment";
import { Annotation, AnnotationData, InputParams } from "./types";
import {
  buildAnnotation,
  escapeStringRegexp,
  exportImage,
  getAnnotationDate,
  getAnnoteDisplayType,
  getCalloutType,
  getColor,
  getImageName,
  getTags,
  groupAnnotations,
  groupCallouts,
  isTask,
  sortAnnotations,
} from "./extractAnnotations.helpers";

export async function extractAnnotations(
  inputPath: string,
  baseName: string,
  assetPath: string = "",
  inputParams: InputParams
) {
  const doc = await PDFNet.PDFDoc.createFromFilePath(inputPath);
  const itr = await doc.getPageIterator();
  const txt = await PDFNet.TextExtractor.create();
  const draw = await PDFNet.PDFDraw.create();
  const annotations: Annotation[] = [];

  const exportDate = new Date().getTime();

  await draw.setDPI(inputParams.imageDPI);

  for (itr; await itr.hasNext(); await itr.next()) {
    const page = await itr.current();
    const pageIndex = await page.getIndex();
    const numAnnots = await page.getNumAnnots();

    for (let i = 0; i < numAnnots; ++i) {
      const annot = await page.getAnnot(i);

      if (!(await annot.isValid())) {
        continue;
      }

      const annotType = await annot.getType();
      const builtAnnot = await buildAnnotation(annot, annotType);

      if (builtAnnot) {
        const date = await getAnnotationDate(builtAnnot);

        txt.begin(page, await page.getCropBox());

        let annotatedText: string;

        const comment = await builtAnnot.getContents();
        const colorObj = await builtAnnot.getColorAsRGB();
        const tags = getTags(comment);
        const rect = await builtAnnot.getRect();
        const type = getAnnoteDisplayType(annotType);
        const color = await getColor(colorObj);

        if (type === "image") {
          if (!inputParams.noWrite) {
            await exportImage({
              assetPath,
              baseName,
              draw,
              annot: builtAnnot as PDFNet.SquareAnnot,
              page,
              pageIndex,
              annotIndex: i,
            });
          }
        } else {
          annotatedText = await txt.getTextUnderAnnot(builtAnnot);
        }

        if (
          annotations.length &&
          inputParams.concatenationPrefix &&
          new RegExp(
            `^${escapeStringRegexp(inputParams.concatenationPrefix)}`,
            "i"
          ).test(comment)
        ) {
          const prev = annotations[annotations.length - 1];

          if (annotatedText && prev.annotatedText) {
            prev.annotatedText.push(annotatedText);
          } else if (annotatedText) {
            prev.annotatedText = [annotatedText];
          }

          const strippedComment = comment.replace(
            new RegExp(
              `^${escapeStringRegexp(inputParams.concatenationPrefix)}\s*`,
              "i"
            ),
            ""
          );

          if (strippedComment) {
            prev.comment = prev.comment
              ? [...prev.comment, strippedComment]
              : [strippedComment];
          }

          if (tags.length) {
            prev.tags = prev.tags ? [...prev.tags, ...tags] : tags;
          }

          if (annotType === PDFNet.Annot.Type.e_Square && prev.imagePath) {
            const imageName = getImageName(baseName, pageIndex, i);
            prev.imagePath = prev.imagePath
              ? [...prev.imagePath, imageName]
              : [imageName];
          }

          continue;
        }

        const annotation: Annotation = {
          annotatedText: undefined,
          comment: undefined,
          type,
          color,
          tags: undefined,
          id: `${type}-${color.replace(/^#/, "")}-${pageIndex}-${Math.round(
            rect.x1
          )}${Math.round(rect.y1)}${Math.round(rect.x2)}${Math.round(rect.y2)}`,
          date: new Date(
            date.valueOf() - date.getTimezoneOffset() * 60 * 1000
          ).getTime(),
          exportDate,
          page: pageIndex,
          imagePath:
            annotType === PDFNet.Annot.Type.e_Square
              ? [getImageName(baseName, pageIndex, i)]
              : undefined,
          isCallout: false,
          isTask: isTask(inputParams.taskPrefix, comment),
        };

        if (tags.length) annotation.tags = tags;
        if (comment) annotation.comment = [comment];
        if (annotatedText) annotation.annotatedText = [annotatedText];

        const callout = inputParams.calloutPrefixes
          ? getCalloutType(inputParams.calloutPrefixes, comment)
          : null;

        if (callout) {
          annotation.isCallout = true;
          annotation.calloutType = callout.type;
        }

        annotations.push(annotation);
      }
    }
  }

  await doc.destroy();
  await draw.destroy();
  await itr.destroy();
  await txt.destroy();

  return annotations;
}

export function prepareAnnotationData(
  inputParams: InputParams,
  annotations: Annotation[]
): AnnotationData {
  sortAnnotations(inputParams, annotations);

  const lastExport = inputParams.lastExportDate
    ? new Date(inputParams.lastExportDate)
    : null;

  return {
    annotations: lastExport
      ? annotations.filter((a) => {
          return moment(a.date).isAfter(lastExport);
        })
      : annotations,
    groupedAnnotations: groupAnnotations(inputParams, annotations),
    callouts: groupCallouts(inputParams, annotations),
  };
}
