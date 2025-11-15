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
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
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
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 3, height: 400 }}>
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
                outerRadius={100}
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

      {/* Recent Connections */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 3, height: 400, overflow: 'auto' }}>
          <Typography variant="h6" gutterBottom>
            Recent Connections
          </Typography>
          <List>
            {recentConnections.map((conn, index) => (
              <ListItem
                key={index}
                sx={{
                  borderLeft: 4,
                  borderColor: conn.action === 'allow' ? 'success.main' : 'error.main',
                  mb: 1,
                  bgcolor: 'background.default',
                }}
              >
                <ListItemText
                  primary={`${conn.executable} → ${conn.dest_host || conn.dest_ip}:${conn.dest_port}`}
                  secondary={
                    <>
                      <Typography component="span" variant="body2" color="textSecondary">
                        {format(new Date(conn.timestamp), 'HH:mm:ss')}
                      </Typography>
                      {' • '}
                      <Typography
                        component="span"
                        variant="body2"
                        color={conn.action === 'allow' ? 'success.main' : 'error.main'}
                      >
                        {conn.action.toUpperCase()}
                      </Typography>
                      {' • '}
                      <Typography component="span" variant="body2" color="textSecondary">
                        {conn.protocol}
                      </Typography>
                    </>
                  }
                />
              </ListItem>
            ))}
            {recentConnections.length === 0 && (
              <ListItem>
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
