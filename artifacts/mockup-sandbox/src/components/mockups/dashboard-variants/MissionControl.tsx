import React from 'react';
import { Activity, AlertTriangle, AlertCircle, Clock, Terminal, CheckCircle2, Server, ServerCrash, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const kpis = [
  { id: 'projects', label: 'ACTIVE PROJECTS', value: '12', status: 'normal' },
  { id: 'tasks', label: 'OPEN TASKS', value: '148', status: 'normal' },
  { id: 'blocked', label: 'BLOCKED ISSUES', value: '07', status: 'warning' },
  { id: 'overdue', label: 'OVERDUE TASKS', value: '03', status: 'critical' },
];

const attentionTasks = [
  { id: 'tsk-921', title: 'Database Migration Failing in Staging', service: 'db-cluster-1', severity: 'critical', time: '2h overdue' },
  { id: 'tsk-918', title: 'SSL Certificate Expiry Warning: internal-api', service: 'tls-manager', severity: 'warning', time: '14h remaining' },
  { id: 'tsk-904', title: 'Node Pool Auto-scaling limits reached', service: 'k8s-prod', severity: 'warning', time: '1d overdue' },
];

const activeProjects = [
  { id: 'prj-alpha', name: 'Q3 Infra Upgrade', progress: 78, tasks: 42, priority: 'HIGH', status: 'normal' },
  { id: 'prj-beta', name: 'Legacy API Deprecation', progress: 42, tasks: 128, priority: 'CRITICAL', status: 'warning' },
  { id: 'prj-gamma', name: 'Security Audit Remediation', progress: 91, tasks: 14, priority: 'HIGH', status: 'normal' },
  { id: 'prj-delta', name: 'Data Warehouse Migration', progress: 15, tasks: 86, priority: 'NORMAL', status: 'normal' },
  { id: 'prj-epsilon', name: 'Redis Cache Optimization', progress: 100, tasks: 24, priority: 'NORMAL', status: 'success' },
];

const activityLog = [
  { id: 'log-1', time: '10:42:01.045', type: 'SYSTEM', message: 'Auto-scaling event triggered in us-east-1' },
  { id: 'log-2', time: '10:35:12.992', type: 'DEPLOY', message: 'v2.4.1 rolled out to production cluster' },
  { id: 'log-3', time: '09:15:00.120', type: 'ALERT', message: 'High memory usage detected on cache-03 (89%)' },
  { id: 'log-4', time: '08:42:15.001', type: 'USER', message: 'Admin access granted to session user:j.smith' },
  { id: 'log-5', time: '08:30:00.000', type: 'SYSTEM', message: 'Daily backup sequence completed successfully' },
  { id: 'log-6', time: '07:15:22.414', type: 'NET', message: 'BGP route updated for secondary failover' },
];

export default function MissionControl() {
  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-400 font-sans selection:bg-emerald-500/30 p-4 md:p-6 lg:p-8 flex flex-col gap-6">
      
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-zinc-800/80">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100 flex items-center gap-3">
            <Terminal className="w-6 h-6 text-emerald-400" />
            SYSTEM STATUS
          </h1>
          <p className="text-zinc-500 font-mono text-xs mt-1 uppercase tracking-wider">
            Primary Ops Terminal // Uptime: 99.998% // Region: US-EAST
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 font-mono text-xs uppercase h-9 rounded-sm bg-zinc-950">
            View All Tasks
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-mono text-xs uppercase h-9 rounded-sm bg-zinc-950">
            Manage Projects
          </Button>
        </div>
      </header>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div 
            key={kpi.id} 
            className={`bg-zinc-900 border-y border-r border-l-2 border-zinc-800/80 p-4 rounded-sm flex flex-col gap-2 relative overflow-hidden group transition-colors ${
              kpi.status === 'normal' ? 'border-l-emerald-500 hover:bg-zinc-800/50' : 
              kpi.status === 'warning' ? 'border-l-amber-500 hover:bg-zinc-800/50' : 
              'border-l-red-500 hover:bg-zinc-800/50'
            }`}
          >
            <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-40 transition-opacity">
              {kpi.status === 'normal' ? <Activity className="w-8 h-8 text-emerald-500" /> :
               kpi.status === 'warning' ? <AlertTriangle className="w-8 h-8 text-amber-500" /> :
               <AlertCircle className="w-8 h-8 text-red-500" />}
            </div>
            <span className="font-mono text-xs text-zinc-500 tracking-wider font-semibold z-10">{kpi.label}</span>
            <span className={`font-mono text-4xl md:text-5xl font-bold tracking-tight z-10 ${
              kpi.status === 'normal' ? 'text-zinc-100' : 
              kpi.status === 'warning' ? 'text-amber-400' : 
              'text-red-400'
            }`}>
              {kpi.value}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Column */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Attention Required */}
          <section className="bg-zinc-900 border border-zinc-800/80 rounded-sm border-l-2 border-l-red-500 overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-zinc-800/60 border-b border-zinc-800/80 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <h2 className="font-mono text-xs font-semibold text-zinc-300 tracking-widest uppercase">Attention Required</h2>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {attentionTasks.length === 0 ? (
                <div className="p-6 text-center font-mono text-sm text-emerald-500 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-6 h-6" />
                  <span>No critical tasks. System nominal.</span>
                </div>
              ) : (
                attentionTasks.map((task) => (
                  <div key={task.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-800/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.8)] ${
                        task.severity === 'critical' ? 'bg-red-500 shadow-red-500/50' : 'bg-amber-500 shadow-amber-500/50'
                      }`} />
                      <div>
                        <div className="text-zinc-200 font-medium tracking-tight text-sm mb-1">{task.title}</div>
                        <div className="flex items-center gap-3 font-mono text-[10px] uppercase text-zinc-500">
                          <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {task.service}</span>
                          <span className="text-zinc-600">|</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {task.time}</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="font-mono text-[10px] h-7 bg-zinc-950 border-zinc-700 hover:bg-zinc-800 rounded-none w-fit">
                      Investigate
                    </Button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Active Projects */}
          <section className="bg-zinc-900 border border-zinc-800/80 rounded-sm overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-zinc-800/60 border-b border-zinc-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h2 className="font-mono text-xs font-semibold text-zinc-300 tracking-widest uppercase">Active Projects</h2>
              </div>
              <span className="font-mono text-[10px] text-zinc-500">SORT: PRIORITY</span>
            </div>
            
            <div className="p-0 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800/80 font-mono text-[10px] text-zinc-500 uppercase tracking-wider bg-zinc-900/50">
                    <th className="px-4 py-2 font-normal">Project</th>
                    <th className="px-4 py-2 font-normal w-32">Progress</th>
                    <th className="px-4 py-2 font-normal text-right">Tasks</th>
                    <th className="px-4 py-2 font-normal">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50 font-mono text-xs">
                  {activeProjects.map(project => (
                    <tr key={project.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-200">{project.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-full h-1.5 bg-zinc-800 rounded-none overflow-hidden">
                            <div 
                              className={`h-full ${
                                project.status === 'warning' ? 'bg-amber-500' :
                                project.status === 'success' ? 'bg-emerald-500' :
                                'bg-emerald-500/70'
                              }`} 
                              style={{ width: `${project.progress}%` }} 
                            />
                          </div>
                          <span className="text-[10px] text-zinc-500 w-6 text-right">{project.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-400">{project.tasks}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-sm text-[9px] font-semibold tracking-wider ${
                          project.priority === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          project.priority === 'HIGH' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-zinc-800 text-zinc-400 border border-zinc-700'
                        }`}>
                          {project.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>

        {/* Right Column */}
        <div className="lg:col-span-1 flex flex-col gap-6 h-full">
          
          {/* Activity Log */}
          <section className="bg-zinc-900 border border-zinc-800/80 rounded-sm overflow-hidden shadow-sm flex flex-col h-full min-h-[400px]">
            <div className="px-4 py-3 bg-zinc-800/60 border-b border-zinc-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-400" />
                <h2 className="font-mono text-xs font-semibold text-zinc-300 tracking-widest uppercase">Activity Log</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-mono text-[9px] text-emerald-500 uppercase tracking-widest">Live</span>
              </div>
            </div>
            
            <div className="flex-1 p-4 font-mono text-xs flex flex-col gap-3 overflow-y-auto max-h-[600px]">
              {activityLog.map((log) => (
                <div key={log.id} className="flex gap-3 leading-relaxed">
                  <span className="text-zinc-600 shrink-0">{log.time}</span>
                  <div className="flex flex-col sm:flex-row sm:gap-2 text-zinc-400 w-full">
                    <span className={`shrink-0 ${
                      log.type === 'ALERT' ? 'text-amber-400' :
                      log.type === 'SYSTEM' ? 'text-emerald-400' :
                      log.type === 'DEPLOY' ? 'text-blue-400' :
                      'text-zinc-300'
                    }`}>
                      [{log.type}]
                    </span>
                    <span className="text-zinc-300 break-words">{log.message}</span>
                  </div>
                </div>
              ))}
              <div className="flex gap-3 text-zinc-500 animate-pulse">
                <span>{new Date().toISOString().split('T')[1].substring(0, 12)}</span>
                <span>_</span>
              </div>
            </div>
          </section>
        </div>
        
      </div>
    </div>
  );
}
