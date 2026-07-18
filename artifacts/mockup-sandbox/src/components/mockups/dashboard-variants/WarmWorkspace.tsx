import React from 'react';
import { 
  Briefcase, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  MoreVertical, 
  ArrowRight,
  Activity,
  User,
  LayoutGrid,
  Settings
} from 'lucide-react';

export default function WarmWorkspace() {
  // Mock Data
  const kpis = [
    { label: "Active Projects", value: "12", icon: Briefcase, color: "text-amber-600", bgColor: "bg-amber-100" },
    { label: "Open Tasks", value: "48", icon: LayoutGrid, color: "text-amber-600", bgColor: "bg-amber-100" },
    { label: "Blocked Issues", value: "3", icon: AlertCircle, color: "text-rose-500", bgColor: "bg-rose-100" },
    { label: "Overdue Tasks", value: "5", icon: Clock, color: "text-orange-500", bgColor: "bg-orange-100" },
  ];

  const attentionTasks = [
    { id: "TASK-4821", title: "Update SSL Certificates", project: "Infrastructure Security", due: "Yesterday", status: "Overdue" },
    { id: "TASK-4902", title: "Resolve Database Deadlock", project: "Core API", due: "Today", status: "Critical" },
    { id: "TASK-4911", title: "Fix Authentication Flow", project: "Mobile App", due: "Tomorrow", status: "Blocked" },
  ];

  const projects = [
    { name: "Cloud Migration", progress: 75, tasks: 24, owner: "Sarah J." },
    { name: "Q3 Security Audit", progress: 40, tasks: 18, owner: "Marcus T." },
    { name: "Employee Portal", progress: 90, tasks: 8, owner: "Elena R." },
    { name: "Network Upgrade", progress: 15, tasks: 32, owner: "David K." },
  ];

  const activities = [
    { id: 1, user: "Elena R.", action: "completed task", target: "Setup CI/CD Pipeline", time: "10 mins ago", type: "success" },
    { id: 2, user: "System", action: "reported issue", target: "High CPU Usage on Node 4", time: "1 hour ago", type: "warning" },
    { id: 3, user: "Marcus T.", action: "commented on", target: "Authentication Flow", time: "2 hours ago", type: "neutral" },
    { id: 4, user: "Sarah J.", action: "created project", target: "Q4 Infrastructure Plan", time: "4 hours ago", type: "neutral" },
    { id: 5, user: "David K.", action: "resolved", target: "Database Connection Error", time: "5 hours ago", type: "success" },
  ];

  return (
    <div className="min-h-screen bg-stone-50 p-6 md:p-8 font-sans text-stone-800">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-900">System Status</h1>
            <p className="text-stone-500 mt-1">Good morning. Here's what needs your attention today.</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 rounded-lg font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 transition-colors">
              Manage Projects
            </button>
            <button className="px-4 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-colors flex items-center gap-2">
              View All Tasks
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm hover:shadow-md hover:border-amber-200 transition-all group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-500">{kpi.label}</p>
                  <p className="text-3xl font-bold text-stone-800 mt-2">{kpi.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${kpi.bgColor} ${kpi.color} group-hover:scale-110 transition-transform`}>
                  <kpi.icon className="w-6 h-6" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-8">
            {/* Attention Required */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-rose-50/30">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <h2 className="text-lg font-semibold text-rose-900">Attention Required</h2>
                </div>
                <button className="text-sm font-medium text-rose-600 hover:text-rose-700">View All</button>
              </div>
              <div className="divide-y divide-stone-100">
                {attentionTasks.map((task, i) => (
                  <div key={i} className="p-6 hover:bg-stone-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 p-2 rounded-lg ${
                        task.status === 'Overdue' ? 'bg-orange-100 text-orange-600' : 
                        task.status === 'Critical' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {task.status === 'Overdue' ? <Clock className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-stone-400">{task.id}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            task.status === 'Overdue' ? 'bg-orange-50 text-orange-700 border border-orange-200' : 
                            task.status === 'Critical' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 
                            'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {task.status}
                          </span>
                        </div>
                        <h3 className="text-base font-medium text-stone-800 mt-1">{task.title}</h3>
                        <p className="text-sm text-stone-500">{task.project}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                      <span className={`text-sm font-medium ${task.due === 'Yesterday' ? 'text-rose-600' : 'text-stone-500'}`}>
                        Due {task.due}
                      </span>
                      <button className="text-stone-400 hover:text-amber-600 transition-colors">
                        <ArrowRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Projects */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-stone-800">Active Projects</h2>
                <button className="p-2 text-stone-400 hover:text-amber-600 rounded-lg hover:bg-amber-50 transition-colors">
                  <LayoutGrid className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {projects.map((project, i) => (
                  <div key={i} className="p-4 rounded-xl border border-stone-100 bg-stone-50/50 hover:bg-amber-50/30 hover:border-amber-200 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="font-medium text-stone-800 group-hover:text-amber-900 transition-colors">{project.name}</h3>
                      <button className="text-stone-400 opacity-0 group-hover:opacity-100 hover:text-amber-600 transition-all">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="mb-4">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-500 font-medium">Progress</span>
                        <span className="text-stone-700 font-bold">{project.progress}%</span>
                      </div>
                      <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-amber-500 rounded-full" 
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm text-stone-500 mt-auto pt-3 border-t border-stone-100">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-stone-400" />
                        <span>{project.tasks} tasks</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <User className="w-4 h-4 text-stone-400" />
                        <span>{project.owner}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar - Activity Log */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 sticky top-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-stone-800">Activity Log</h2>
                <Activity className="w-5 h-5 text-stone-400" />
              </div>
              
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-stone-200 before:via-stone-200 before:to-transparent">
                {activities.map((activity, i) => (
                  <div key={activity.id} className="relative flex items-start gap-4">
                    <div className="absolute left-0 md:left-1/2 md:-ml-2.5 flex items-center justify-center">
                      <div className={`w-5 h-5 rounded-full border-4 border-white flex-shrink-0 relative z-10 ${
                        activity.type === 'success' ? 'bg-emerald-500' :
                        activity.type === 'warning' ? 'bg-orange-500' : 'bg-amber-400'
                      }`} />
                    </div>
                    
                    <div className="ml-8 md:ml-0 md:w-full md:pl-8 py-0.5">
                      <div className="flex flex-col gap-1">
                        <p className="text-sm text-stone-600">
                          <span className="font-medium text-stone-800">{activity.user}</span>
                          {' '}{activity.action}{' '}
                          <span className="font-medium text-stone-800">{activity.target}</span>
                        </p>
                        <span className="text-xs text-stone-400 font-medium">{activity.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <button className="w-full mt-8 py-2.5 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-xl transition-colors">
                View Complete Log
              </button>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
