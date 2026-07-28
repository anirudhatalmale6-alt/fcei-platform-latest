# API Contract

Core endpoints:

- GET /api/site
- GET /api/catalogue
- GET /api/courses/:courseId
- POST /api/auth/register
- POST /api/auth/login
- POST /api/checkout/create
- POST /api/payments/mock-confirm
- GET /api/dashboard
- GET /api/lms/courses/:courseId/modules/:moduleId
- POST /api/lms/modules/:moduleId/content-opened
- POST /api/lms/modules/:moduleId/resource-accessed
- POST /api/lms/modules/:moduleId/quiz-attempt
- POST /api/lms/modules/:moduleId/action-task
- POST /api/lms/modules/:moduleId/evidence
- POST /api/lms/modules/:moduleId/reflection
- POST /api/lms/modules/:moduleId/transferability
- POST /api/lms/modules/:moduleId/checklist
- GET /api/scorm/lessons
- GET /api/scorm/lessons/:moduleId
- POST /api/scorm/register
- POST /api/scorm/runtime/:moduleId
- GET /api/toolkits
- POST /api/toolkits/:toolkitId/purchase
- GET /api/toolkits/:toolkitId/download
- POST /api/bookings
- POST /api/cookie-consent
- GET /api/admin/overview
- POST /api/admin/cms
- GET /api/certificates/verify/:code
