import React from "react";
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  MoreHorizontal, 
  Plus, 
  Search,
  Circle,
  Dot
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

// Hardcoded mock data
const kpiData = {
  activeProjects: 4,
  openTasks: 12,
  blockedIssues: 2,
  overdueTasks: 1,
};

const attentionRequired = [
  {
    id: "TSK-089",
    title: "Database migration failing in staging",
    project: "Infrastructure Q3",
    dueDate: "2 days ago",
    assignee: { name: "Alex Chen", initials: "AC" },
    priority: "critical",
    type: "overdue"
  },
  {
    id: "TSK-092",
    title: "Review security audit findings",
    project: "Compliance",
    dueDate: "Today",
    assignee: { name: "Sarah Miller", initials: "SM" },
    priority: "high",
    type: "blocked"
  }
];

const activeProjects = [
  {
    id: "PRJ-12",
    title: "Infrastructure Q3",
    progress: 78,
    status: "on-track",
    dueDate: "Oct 15",
  },
  {
    id: "PRJ-14",
    title: "SOC2 Compliance Prep",
    progress: 45,
    status: "at-risk",
    dueDate: "Nov 01",
  },
  {
    id: "PRJ-15",
    title: "Employee Onboarding Portal",
    progress: 12,
    status: "on-track",
    dueDate: "Dec 10",
  }
];

const activityLog = [
  {
    id: 1,
    action: "completed task",
    target: "Setup VPN for new hires",
    user: "David Kim",
    time: "2 hours ago"
  },
  {
    id: 2,
    action: "commented on",
    target: "Database migration failing",
    user: "Alex Chen",
    time: "4 hours ago"
  },
  {
    id: 3,
    action: "created project",
    target: "Employee Onboarding Portal",
    user: "Sarah Miller",
    time: "Yesterday"
  }
];

export default function CalmFeed() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        
        {/* Header & Status Bar */}
        <header className="mb-12">
          <div className="flex items-end justify-between mb-6">
            <div>
              <h1 className="text-xl font-medium text-gray-900 tracking-tight">System Status</h1>
              <p className="text-sm text-gray-500 mt-1">IT Operations Overview</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-xs font-medium text-gray-600 hover:text-gray-900">
                Manage Projects
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs font-medium border-gray-200">
                View All Tasks
              </Button>
            </div>
          </div>
          
          {/* Inline KPI Strip */}
          <div className="flex flex-wrap items-center text-sm text-gray-600 bg-gray-50/50 px-4 py-2.5 rounded-lg border border-gray-100 gap-y-2">
            <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> {kpiData.activeProjects} active projects</span>
            <span className="text-gray-300 mx-3 hidden sm:inline">/</span>
            <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span> {kpiData.openTasks} open tasks</span>
            <span className="text-gray-300 mx-3 hidden sm:inline">/</span>
            <span className={`flex items-center gap-2 ${kpiData.blockedIssues > 0 ? 'text-orange-700 font-medium' : ''}`}><span className={`w-1.5 h-1.5 rounded-full ${kpiData.blockedIssues > 0 ? 'bg-orange-500' : 'bg-gray-300'}`}></span> {kpiData.blockedIssues} blocked</span>
            <span className="text-gray-300 mx-3 hidden sm:inline">/</span>
            <span className={`flex items-center gap-2 ${kpiData.overdueTasks > 0 ? 'text-red-700 font-medium' : ''}`}><span className={`w-1.5 h-1.5 rounded-full ${kpiData.overdueTasks > 0 ? 'bg-red-500' : 'bg-gray-300'}`}></span> {kpiData.overdueTasks} overdue</span>
          </div>
        </header>

        {/* Unified Feed */}
        <div className="space-y-10">
          
          {/* Attention Required */}
          <section>
            <h2 className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase mb-4 px-2">Attention Required</h2>
            <div className="flex flex-col space-y-1">
              {attentionRequired.map(task => (
                <div key={task.id} className="group flex items-start sm:items-center justify-between py-3 px-2 hover:bg-gray-50/80 rounded-md transition-colors -mx-2 flex-col sm:flex-row gap-4 sm:gap-0">
                  <div className="flex items-start gap-3 w-full sm:w-auto">
                    <div className="mt-1.5 sm:mt-1">
                      {task.type === 'overdue' ? (
                        <div className="w-2 h-2 rounded-full bg-red-500 ring-4 ring-red-50" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-orange-500 ring-4 ring-orange-50" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 cursor-pointer hover:underline underline-offset-4 decoration-gray-300">{task.title}</span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-gray-100 text-gray-600 font-medium hover:bg-gray-100 border-none rounded">{task.id}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-gray-300"></span> {task.project}</span>
                        <span className={task.type === 'overdue' ? 'text-red-600' : ''}>Due: {task.dueDate}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 sm:opacity-0 group-hover:opacity-100 transition-opacity self-end sm:self-auto">
                    <div className="h-6 w-6 rounded-full border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                      <span className="text-[9px] text-gray-600 font-medium">{task.assignee.initials}</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* Active Projects */}
          <section>
            <h2 className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase mb-4 px-2">Active Projects</h2>
            <div className="flex flex-col space-y-1">
              {activeProjects.map(project => (
                <div key={project.id} className="group flex flex-col sm:flex-row sm:items-center justify-between py-3 px-2 hover:bg-gray-50/80 rounded-md transition-colors -mx-2 gap-4 sm:gap-0">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-2 h-2 rounded-full bg-blue-500 ring-4 ring-blue-50 flex-shrink-0" />
                    <div className="flex flex-col min-w-[200px]">
                      <span className="text-sm font-medium text-gray-900 cursor-pointer hover:underline underline-offset-4 decoration-gray-300">{project.title}</span>
                      <span className="text-xs text-gray-500 mt-0.5">Due {project.dueDate}</span>
                    </div>
                  </div>
                  <div className="flex-1 w-full sm:max-w-[16rem] sm:mx-6 flex items-center gap-3 ml-5 sm:ml-0">
                    <Progress value={project.progress} className="h-1.5 bg-gray-100" />
                    <span className="text-xs text-gray-500 font-mono w-8 text-right">{project.progress}%</span>
                  </div>
                  <div className="flex items-center gap-4 hidden sm:flex">
                    <Badge variant="outline" className={`h-5 px-2 text-[10px] font-medium border-none rounded ${project.status === 'at-risk' ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-600'}`}>
                      {project.status.replace('-', ' ')}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* Activity Log */}
          <section>
            <h2 className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase mb-4 px-2">Recent Activity</h2>
            <div className="flex flex-col space-y-1">
              {activityLog.map(log => (
                <div key={log.id} className="flex items-start gap-3 py-2.5 px-2 -mx-2 hover:bg-gray-50/50 rounded-md transition-colors">
                  <div className="mt-0.5 text-gray-300 flex-shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1 sm:gap-4">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-gray-900">{log.user}</span> {log.action} <span className="font-medium text-gray-900">{log.target}</span>
                    </p>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{log.time}</span>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-4 px-2 -mx-2">
               <Button variant="ghost" size="sm" className="h-8 text-xs font-medium text-gray-500 hover:text-gray-900 w-full flex justify-start pl-7">
                  View older activity
               </Button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
