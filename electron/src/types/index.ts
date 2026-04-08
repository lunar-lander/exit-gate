export interface Rule {
  id?: number;
  name: string;
  enabled: boolean;
  action: 'allow' | 'deny';
  duration: 'once' | 'process' | 'forever' | 'untilrestart';
  priority: number;
  criteria: RuleCriteria;
  created_at: string;
  updated_at: string;
  hit_count: number;
  last_hit?: string;
}

export interface RuleCriteria {
  executable?: string;
  executable_regex?: string;
  cmdline?: string;
  dest_ip?: string;
  dest_network?: string;
  dest_port?: number;
  dest_port_range?: [number, number];
  dest_host?: string;
  dest_host_regex?: string;
  protocol?: string;
  uid?: number;
  gid?: number;
}

export interface ConnectionPrompt {
  prompt_id: string;
  pid: number;
  uid: number;
  executable: string;
  cmdline: string;
  dest_ip: string;
  dest_port: number;
  dest_host?: string;
  protocol: string;
}

export interface ConnectionEvent {
  timestamp: string;
  pid: number;
  executable: string;
  dest_ip: string;
  dest_port: number;
  dest_host?: string;
  protocol: string;
  action: string;
}

export interface HistoryEntry {
  id: number;
  timestamp: string;
  pid: number;
  uid: number;
  gid: number;
  executable: string;
  cmdline: string;
  dest_ip: string;
  dest_port: number;
  dest_host?: string;
  protocol: string;
  action: string;
  rule_id?: number;
}

export interface Stats {
  total_connections: number;
  allowed: number;
  denied: number;
  active_rules: number;
}

export interface DaemonMessage {
  type: string;
  [key: string]: any;
}

declare global {
  interface Window {
    electron: {
      sendToDaemon: (message: any) => Promise<any>;
      onDaemonMessage: (callback: (message: DaemonMessage) => void) => () => void;
      getRules: () => Promise<void>;
      addRule: (rule: Rule) => Promise<void>;
      updateRule: (rule: Rule) => Promise<void>;
      deleteRule: (ruleId: number) => Promise<void>;
      getHistory: (limit: number) => Promise<void>;
      getHistorySince: (timestamp: string) => Promise<void>;
      getStats: () => Promise<void>;
      respondToPrompt: (
        promptId: string,
        action: string,
        remember: boolean,
        duration: string
      ) => Promise<void>;
    };
  }
}

export {};
