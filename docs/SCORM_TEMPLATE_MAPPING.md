# SCORM Lesson Template Mapping

The uploaded SCORM lesson/module structure is applied to all FCEI modules using these six sections:

1. Welcome and Evidence Portfolio Roadmap
2. Turning Values into Daily Practice
3. Designing Support Core Extension Pathways
4. Synthesizing Evidence and Embedding Improvements
5. Final Performance and Evidence Check
6. Wrap Up and Next Steps

Each generated lesson JSON includes module-specific aim, principle, tool, action task, evidence task, quiz, resources and Transferability Filter.

The runtime endpoint is:

POST /api/scorm/runtime/:moduleId

Payload example:

```json
{"lessonStatus":"completed","score":100,"suspendData":"..."}
```

When SCORM status is completed or passed, the LMS sets `contentOpened=true`. Full FCEI module completion still requires quiz, resources, action task, evidence, reflection, Transferability Filter and checklist.
