import React from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Security,
  NetworkCheck,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Stats, HistoryEntry } from '../types';
import { format } from 'date-fns';

interface DashboardProps {
  stats: Stats;
  recentConnections: HistoryEntry[];
}

const Dashboard: React.FC<DashboardProps> = ({ stats, recentConnections }) => {
  const pieData = [
    { name: 'Allowed', value: stats.allowed, color: '#00e676' },
    { name: 'Denied', value: stats.denied, color: '#ff1744' },
  ];

  // Aggregate data by application
  const appData = recentConnections.reduce((acc, conn) => {
    const app = conn.executable.split('/').pop() || conn.executable;
    acc[app] = (acc[app] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const appChartData = Object.entries(appData)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Aggregate data by domain
  const domainData = recentConnections.reduce((acc, conn) => {
    const domain = conn.dest_host || conn.dest_ip;
    acc[domain] = (acc[domain] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const domainChartData = Object.entries(domainData)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return (
    <Grid container spacing={3}>
      {/* Stats Cards */}
      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Total Connections
                </Typography>
                <Typography variant="h4">{stats.total_connections}</Typography>
              </Box>
              <NetworkCheck sx={{ fontSize: 48, color: 'primary.main' }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Allowed
                </Typography>
                <Typography variant="h4" color="success.main">
                  {stats.allowed}
                </Typography>
              </Box>
              <CheckCircle sx={{ fontSize: 48, color: 'success.main' }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Denied
                </Typography>
                <Typography variant="h4" color="error.main">
                  {stats.denied}
                </Typography>
              </Box>
              <Cancel sx={{ fontSize: 48, color: 'error.main' }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Active Rules
                </Typography>
                <Typography variant="h4">{stats.active_rules}</Typography>
              </Box>
              <Security sx={{ fontSize: 48, color: 'primary.main' }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Pie Chart */}
      <Grid item xs={12} md={6} lg={4}>
        <Paper sx={{ p: 3, height: 350 }}>
          <Typography variant="h6" gutterBottom>
            Connection Statistics
          </Typography>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Paper>
      </Grid>

      {/* Applications Bar Chart */}
      <Grid item xs={12} md={6} lg={4}>
        <Paper sx={{ p: 3, height: 350 }}>
          <Typography variant="h6" gutterBottom>
            Top Applications
          </Typography>
          {appChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={appChartData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  type="number" 
                  scale="log" 
                  domain={['dataMin', 'dataMax']}
                  allowDataOverflow
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={80}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip formatter={(value) => [value, 'Requests']} />
                <Bar dataKey="count" fill="#00e676" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Box display="flex" alignItems="center" justifyContent="center" height="90%">
              <Typography color="textSecondary">
                No application data available
              </Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      {/* Domains Bar Chart */}
      <Grid item xs={12} md={6} lg={4}>
        <Paper sx={{ p: 3, height: 350 }}>
          <Typography variant="h6" gutterBottom>
            Top Domains
          </Typography>
          {domainChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={domainChartData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  type="number" 
                  scale="log" 
                  domain={['dataMin', 'dataMax']}
                  allowDataOverflow
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={120}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip formatter={(value) => [value, 'Connections']} />
                <Bar dataKey="count" fill="#ff9800" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Box display="flex" alignItems="center" justifyContent="center" height="90%">
              <Typography color="textSecondary">
                No domain data available
              </Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      {/* Recent Connections */}
      <Grid item xs={12}>
        <Paper sx={{ p: 3, maxHeight: 300, overflow: 'auto' }}>
          <Typography variant="h6" gutterBottom>
            Recent Connections
          </Typography>
          <List sx={{ py: 0 }}>
            {recentConnections.map((conn, index) => (
              <ListItem
                key={index}
                sx={{
                  borderLeft: 3,
                  borderColor: conn.action === 'allow' ? 'success.main' : 'error.main',
                  mb: 0.5,
                  bgcolor: 'background.default',
                  minHeight: 48,
                  py: 0.5,
                }}
              >
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {`${conn.executable.split('/').pop()} → ${conn.dest_host || conn.dest_ip}:${conn.dest_port}`}
                    </Typography>
                  }
                  secondary={
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.25 }}>
                      <Typography variant="caption" color="textSecondary">
                        {format(new Date(conn.timestamp), 'HH:mm:ss')}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: conn.action === 'allow' ? 'success.main' : 'error.main',
                          fontWeight: 600,
                        }}
                      >
                        {conn.action.toUpperCase()}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {conn.protocol}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {recentConnections.length === 0 && (
              <ListItem sx={{ minHeight: 48 }}>
                <ListItemText
                  primary="No recent connections"
                  secondary="Connection events will appear here"
                />
              </ListItem>
            )}
          </List>
        </Paper>
      </Grid>
    </Grid>
  );
};

export default Dashboard;
