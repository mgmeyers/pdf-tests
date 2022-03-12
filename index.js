const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { format, parse, isBefore } = require("date-fns");

const { PDFNet } = require("@pdftron/pdfnet-node");

// `.env` file must have KEY="YOUR KEY"
// get a demo key from here: https://www.pdftron.com/documentation/nodejs/get-started/integration/
dotenv.config();

function getAnnoteDisplayType(type) {
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

const colorMap = {
  "255, 128, 128": "red",
  "255, 191, 128": "orange",
  "255, 255, 128": "yellow",
  "128, 255, 128": "green",
  "128, 255, 255": "blue",
  "255, 128, 255": "pink",
  "191, 128, 191": "purple",
  "192, 192, 192": "gray",
};

async function getColor(colorPt) {
  const r = Math.round((await colorPt.get(0)) * 255);
  const g = Math.round((await colorPt.get(1)) * 255);
  const b = Math.round((await colorPt.get(2)) * 255);

  const key = `${r}, ${g}, ${b}`;

  return colorMap[key] || "yellow";
}

async function extractAnnotations(inputPath, baseName, assetPath = "") {
  const doc = await PDFNet.PDFDoc.createFromFilePath(inputPath);
  const itr = await doc.getPageIterator();
  const txt = await PDFNet.TextExtractor.create();
  const draw = await PDFNet.PDFDraw.create();
  const output = [];

  let assetPathExists = false;

  await draw.setDPI(100);

  for (itr; await itr.hasNext(); await itr.next()) {
    const page = await itr.current();
    const numAnnots = await page.getNumAnnots();

    for (let i = 0; i < numAnnots; ++i) {
      const annot = await page.getAnnot(i);

      if (!(await annot.isValid())) {
        continue;
      }

      const annotType = await annot.getType();

      let builtAnnot;

      switch (annotType) {
        case PDFNet.Annot.Type.e_Text:
          builtAnnot = await PDFNet.TextAnnot.createFromAnnot(annot);
          break;
        case PDFNet.Annot.Type.e_Underline:
          builtAnnot = await PDFNet.UnderlineAnnot.createFromAnnot(annot);
          break;
        case PDFNet.Annot.Type.e_Highlight:
          builtAnnot = await PDFNet.HighlightAnnot.createFromAnnot(annot);
          break;
        case PDFNet.Annot.Type.e_StrikeOut:
          builtAnnot = await PDFNet.StrikeOutAnnot.createFromAnnot(annot);
          break;
        case PDFNet.Annot.Type.e_Square:
          builtAnnot = await PDFNet.SquareAnnot.createFromAnnot(annot);

          const rect = await builtAnnot.getRect();

          if (!assetPathExists) {
            if (!fs.existsSync(assetPath)) {
              fs.mkdirSync(assetPath, { recursive: true });
            }

            assetPathExists = true;
          }

          await draw.setClipRect(rect);
          await draw.export(
            page,
            path.resolve(
              assetPath,
              `${baseName}-p${await page.getIndex()}-a${i}.png`
            ),
            "PNG"
          );

          break;
        default:
          break;
      }

      if (builtAnnot) {
        const comment = await builtAnnot.getContents();
        const colorObj = await builtAnnot.getColorAsRGB();
        const dateObj = await builtAnnot.getDate();

        txt.begin(page, await page.getCropBox());

        const annotatedText = await txt.getTextUnderAnnot(builtAnnot);

        const rect = await builtAnnot.getRect();
        const type = getAnnoteDisplayType(annotType);
        const color = await getColor(colorObj);

        const date = new Date();

        date.setFullYear(dateObj.year);
        date.setMonth(dateObj.month - 1);
        date.setDate(dateObj.day);
        date.setHours(dateObj.hour);
        date.setMinutes(dateObj.minute);
        date.setSeconds(dateObj.second);

        output.push({
          id: `${type}-${color}-${Math.round(rect.x1)}${Math.round(
            rect.y1
          )}${Math.round(rect.x2)}${Math.round(rect.y2)}`,
          annotatedText,
          comment,
          type,
          color,
          date: new Date(date.valueOf() - date.getTimezoneOffset() * 60 * 1000),
          isTask: comment && comment.toLowerCase().startsWith("todo:"),
          page: await page.getIndex(),
          image:
            annotType === PDFNet.Annot.Type.e_Square
              ? `${baseName}-p${await page.getIndex()}-a${i}.png`
              : null,
        });
      }
    }
  }

  await draw.destroy();
  await txt.destroy();

  return output;
}

function processAnnotations(annotations) {
  const output = [];

  const meta = {
    keywords: [],
    questions: [],
    callouts: [],
    definitions: [],
  };

  annotations.forEach((a) => {
    if (a.comment.startsWith("+")) {
      const last = output.pop();

      if (a.comment.trim() !== "+") {
        last.comment += "\n" + a.comment.trim().replace(/^\+\s+/, "");
      }

      last.annotatedText += "\n" + a.annotatedText;

      return output.push(last);
    }

    if (a.comment.toLowerCase().startsWith("keyword")) {
      meta.keywords.push(a.annotatedText.trim());
    }

    if (a.comment.toLowerCase().startsWith("keyword:")) {
      meta.keywords.push(
        ...a.comment
          .trim()
          .replace(/^keyword: /, "")
          .split(/\s*,\s*/g)
      );
    }

    if (a.comment.toLowerCase().startsWith("question:")) {
      const comment = a.comment.replace(/^question:\s+/, "").trim();

      meta.questions.push({
        page: a.page,
        comment,
        image: comment ? null : a.image,
      });
    }

    if (a.comment.toLowerCase().startsWith("question")) {
      const comment = a.annotatedText.trim();

      meta.questions.push({
        page: a.page,
        comment,
        image: comment ? null : a.image,
      });
    }

    if (a.comment.toLowerCase().startsWith("important:")) {
      const comment = a.comment.replace(/^important:\s+/, "").trim();

      meta.callouts.push({
        page: a.page,
        comment,
        image: comment ? null : a.image,
      });
    }

    if (a.comment.trim().toLowerCase() === "important") {
      const comment = a.annotatedText.trim();

      meta.callouts.push({
        page: a.page,
        comment,
        image: comment ? null : a.image,
      });
    }

    if (a.comment.toLowerCase().startsWith("definition:")) {
      const comment = a.comment.replace(/^definition:\s+/, "").trim();

      meta.definitions.push({
        page: a.page,
        comment,
        image: comment ? null : a.image,
      });
    }

    if (a.comment.toLowerCase().startsWith("definition")) {
      const comment = a.annotatedText.trim();

      meta.definitions.push({
        page: a.page,
        comment,
        image: comment ? null : a.image,
      });
    }

    output.push(a);
  });

  return {
    annotations: output,
    meta,
  };
}

function handleMultilineComment(comment) {
  return comment.replace(/\n+(?:- )?/g, "\n>    - ");
}

function buildPreamble(citeKey, baseName, inputPath, meta) {
  let output = [
    `> [!info]\n`,
    `> - **Cite Key:** [[@${citeKey}]]\n`,
    `> - **Link:** [${baseName}](file://${encodeURI(inputPath)})\n`,
  ];

  if (meta.keywords.length) {
    output.push("> - **Keywords:** " + meta.keywords.join(", ") + "\n");
  }

  output.push("\n");

  if (meta.questions.length) {
    output.push("> [!question: Questions]\n");

    meta.questions.forEach((q) => {
      if (q.image) {
        return output.push(
          `> - ![[${q.image}]]\n> [page ${
            q.page
          }](highlights://${encodeURIComponent(baseName)}#page=${q.page})\n`
        );
      }

      output.push(
        `> - ${handleMultilineComment(
          q.comment.replace(/^question:\s*/i, "")
        )}\n> [page ${q.page}](highlights://${encodeURIComponent(
          baseName
        )}#page=${q.page})\n`
      );
    });

    output.push("\n");
  }

  if (meta.callouts.length) {
    output.push("> [!important: Callouts]\n");

    meta.callouts.forEach((q) => {
      if (q.image) {
        return output.push(
          `> - ![[${q.image}]]\n> [page ${
            q.page
          }](highlights://${encodeURIComponent(baseName)}#page=${q.page})\n`
        );
      }

      output.push(
        `> - ${handleMultilineComment(
          q.comment.replace(/^important:\s*/i, "")
        )}\n> [page ${q.page}](highlights://${encodeURIComponent(
          baseName
        )}#page=${q.page})\n`
      );
    });

    output.push("\n");
  }

  if (meta.definitions.length) {
    output.push("> [!example: Definitions]\n");

    meta.definitions.forEach((q) => {
      if (q.image) {
        return output.push(
          `> - ![[${q.image}]]\n> [page ${
            q.page
          }](highlights://${encodeURIComponent(baseName)}#page=${q.page})\n`
        );
      }

      output.push(
        `> - ${handleMultilineComment(
          q.comment.replace(/^definition:\s*/i, "")
        )}\n> [page ${q.page}](highlights://${encodeURIComponent(
          baseName
        )}#page=${q.page})\n`
      );
    });

    output.push("\n");
  }

  output.push("\n## Annotations\n\n");

  return output;
}

function getPreviousExport(existingMarkdown) {
  let prevExport = existingMarkdown.replace(/^[\w\W]+\n## Annotations\n\n/, "");

  const matches = prevExport.matchAll(/### Exported: (.+)/g);

  let prevExportDate;

  for (const match of matches) {
    prevExportDate = match[1];
  }

  return {
    prevExport,
    prevExportDate: parse(prevExportDate, "yyyy-MM-dd h:mm aaa", new Date()),
  };
}

function buildMarkdown(
  citeKey,
  existingMarkdown,
  inputPath,
  baseName,
  annotationsRaw
) {
  const { annotations, meta } = processAnnotations(annotationsRaw);

  const output = buildPreamble(citeKey, baseName, inputPath, meta);

  const { prevExport, prevExportDate } = existingMarkdown
    ? getPreviousExport(existingMarkdown)
    : { prevExport: null, prevExportDate: null };

  if (prevExport) output.push(prevExport);

  const annotOutput = [];

  annotations.forEach((a) => {
    if (prevExportDate && isBefore(a.date, prevExportDate)) {
      return;
    }

    let str = "";

    if (a.annotatedText && a.type !== "note" && a.type !== "image") {
      const text = a.annotatedText.trim().replace(/\n+/g, "\n");

      if (a.type === "underline") {
        str += `> [!underline_${a.color}]\n> ${text}\n`;
      } else if (a.type === "strikethrough") {
        str += `> [!strike_${a.color}]\n> ${text}\n`;
      } else {
        str += `> [!highlight_${a.color}]\n> ${text}\n`;
      }

      str += `> [page ${a.page}](highlights://${encodeURIComponent(
        baseName
      )}#page=${a.page}) - [[${format(a.date, "yyyy-MM-dd#h:mm aaa")}]]\n`;
    } else if (a.type === "note" && a.comment) {
      str += `> [!note]\n> [page ${a.page}](highlights://${encodeURIComponent(
        baseName
      )}#page=${a.page}) - [[${format(a.date, "yyyy-MM-dd#h:mm aaa")}]]\n`;
    } else if (a.type === "image" && a.image) {
      str += `> [!image]\n> ![[${a.image}]]\n`;
      str += `> [page ${a.page}](highlights://${encodeURIComponent(
        baseName
      )}#page=${a.page}) - [[${format(a.date, "yyyy-MM-dd#h:mm aaa")}]]\n`;
    }

    if (a.comment) {
      const marker = a.isTask ? "- [ ] " : "- ";
      str += `> ${marker}${a.comment.trim().replace(/\n+/g, `\n>    `)}\n`;
    }

    str += "\n";

    annotOutput.push(str);
  });

  if (annotOutput.length) {
    output.push(
      `### Exported: ${format(new Date(), "yyyy-MM-dd h:mm aaa")}\n\n`,
      ...annotOutput
    );
  }

  return output.join("");
}

async function main() {
  const citeKey = process.argv[2];
  const pdfPath = process.argv[3];
  const outputPath = process.argv[4];
  let assetPath = process.argv[5];

  if (!fs.existsSync(pdfPath)) {
    throw new Error("Target PDF does not exist");
  }

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const baseName = path.basename(pdfPath, ".pdf");
  assetPath = path.join(assetPath, baseName);

  const outputFile = path.resolve(outputPath, `${baseName}.md`);
  let existingMarkdown = null;

  if (fs.existsSync(outputFile)) {
    existingMarkdown = fs.readFileSync(outputFile).toString();
  }

  const annotations = await extractAnnotations(pdfPath, baseName, assetPath);
  const markdown = buildMarkdown(
    citeKey,
    existingMarkdown,
    pdfPath,
    baseName,
    annotations
  );

  fs.writeFileSync(outputFile, markdown);
}

PDFNet.runWithCleanup(main, process.env.KEY)
  .catch((error) => {
    console.log("Error: ", error);
  })
  .then(() => {
    PDFNet.shutdown();
  });
