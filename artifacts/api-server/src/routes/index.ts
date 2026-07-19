import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import orgsRouter from "./orgs";
import rolesRouter from "./roles";
import projectsRouter from "./projects";
import tasksRouter from "./tasks";
import commentsRouter from "./comments";
import notesRouter from "./notes";
import dashboardRouter from "./dashboard";
import docsRouter from "./docs";
import webhooksRouter from "./webhooks";
import customFieldsRouter from "./custom-fields";
import savedViewsRouter from "./saved-views";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(orgsRouter);
router.use(rolesRouter);
router.use(projectsRouter);
router.use(tasksRouter);
router.use(commentsRouter);
router.use(notesRouter);
router.use(dashboardRouter);
router.use(docsRouter);
router.use(webhooksRouter);
router.use(customFieldsRouter);
router.use(savedViewsRouter);

export default router;
