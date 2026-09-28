import path from "node:path";
import { validateTutorCourseContentDirectory } from "../server/services/course-content/tutor-quality-directory-validator.ts";

const directory = process.argv[2];
if (directory === undefined || directory.length === 0) {
  console.error("Usage: npm run validate:tutor-course-content -- <course-content-directory>");
  process.exitCode = 2;
} else {
  const resolved = path.resolve(directory);
  const issues = await validateTutorCourseContentDirectory(resolved);
  if (issues.length === 0) {
    console.log(`Tutor Course Content quality passed: ${resolved}`);
  } else {
    for (const issue of issues) {
      const scope = [issue.caseId, issue.topicId, issue.conceptId, issue.indicatorId].filter(Boolean).join("/");
      const scopeSuffix = scope ? ` [${scope}]` : "";
      console.error(`${issue.code}${scopeSuffix}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
}
