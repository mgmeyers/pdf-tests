import { PDFNet } from "@pdftron/pdfnet-node";
import fs from "fs";
import path from "path";
import { DefaultInputParams, InputParams } from "./types";
import {
  extractAnnotations,
  prepareAnnotationData,
} from "./extractAnnotations";
import { stderr, stdout, argv } from "process";

function process() {
  if (!argv[2]) {
    return stderr.write("Error: configuration required");
  }

  const params: InputParams = {
    ...DefaultInputParams,
    ...(JSON.parse(argv[2]) as InputParams),
  };
  const { pdfInputPath, assetOutputPath } = params;

  if (!fs.existsSync(pdfInputPath)) {
    return stderr.write("Target PDF does not exist");
  }

  const baseName = path.basename(pdfInputPath, ".pdf");
  PDFNet.runWithCleanup(async () => {
    const annotations = await extractAnnotations(
      pdfInputPath,
      baseName,
      assetOutputPath,
      params
    );

    stdout.write(JSON.stringify(prepareAnnotationData(params, annotations)));
  }, params.apiKey)
    .catch((error) => {
      stderr.write(error.message);
    })
    .then(() => {
      PDFNet.shutdown();
    });
}

process();
