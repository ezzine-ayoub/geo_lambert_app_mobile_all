import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router, Stack } from 'expo-router';

export default function ProjectDetailsScreen() {
  const params = useLocalSearchParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (params.project) {
      try {
        const projectData = JSON.parse(params.project as string);
        setProject(projectData);
        setLoading(false);
      } catch (error) {
        console.error('Erreur parsing project data:', error);
        Alert.alert('Erreur', 'Impossible de charger les détails du projet');
        router.back();
      }
    }
  }, [params.project]);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    // Simuler un refresh - supprimé setTimeout
    setRefreshing(false);
  }, []);

  const getTaskStatusIcon = (state) => {
    switch (state) {
      case '03_approved':
        return { name: 'checkmark-circle', color: '#10b981' };
      case '01_in_progress':
        return { name: 'play-circle', color: '#3b82f6' };
      case '02_changes_requested':
        return { name: 'warning-outline', color: '#f59e0b' };
      default:
        return { name: 'ellipse-outline', color: '#6b7280' };
    }
  };

  const getTaskStatusColors = (state) => {
    switch (state) {
      case '03_approved':
        return {
          backgroundColor: '#f0fdf4', // Vert très clair
          borderColor: '#10b981',
          textColor: '#059669'
        };
      case '01_in_progress':
        return {
          backgroundColor: '#eff6ff', // Bleu très clair
          borderColor: '#3b82f6',
          textColor: '#2563eb'
        };
      case '02_changes_requested':
        return {
          backgroundColor: '#fffbeb', // Orange très clair
          borderColor: '#f59e0b',
          textColor: '#d97706'
        };
      default:
        return {
          backgroundColor: '#f9fafb', // Gris très clair
          borderColor: '#e5e7eb',
          textColor: '#6b7280'
        };
    }
  };

  const getTaskStatusText = (state) => {
    switch (state) {
      case '03_approved':
        return 'Approuvée';
      case '01_in_progress':
        return 'En cours';
      case '02_changes_requested':
        return 'Modifications demandées';
      default:
        return 'Non défini';
    }
  };

  const handleTaskPress = (task) => {
    console.log('🎯 Navigation vers dépenses de tâche:', task.name);
    router.push({
      pathname: '/(tabs)/task-expenses',
      params: {
        task: JSON.stringify(task),
        taskName: task.name,
        projectName: project.name
      }
    });
  };

  const TaskCard = ({ task }) => {
    const statusIcon = getTaskStatusIcon(task.state);
    const statusColors = getTaskStatusColors(task.state);

    return (
      <TouchableOpacity
        style={[
          styles.taskCard,
          {
            backgroundColor: statusColors.backgroundColor,
            borderLeftWidth: 4,
            borderLeftColor: statusColors.borderColor,
          }
        ]}
        onPress={() => handleTaskPress(task)}
        activeOpacity={0.7}
      >
        <View style={styles.taskHeader}>
          <View style={styles.taskStatus}>
            <Ionicons name={statusIcon.name} size={20} color={statusIcon.color} />
          </View>
          <View style={styles.taskContent}>
            <Text style={styles.taskTitle}>{task.name}</Text>
            <Text style={[
              styles.taskStatusText,
              { color: statusColors.textColor }
            ]}>
              {getTaskStatusText(task.state)}
            </Text>
            {task.user_ids && task.user_ids.length > 0 && (
              <Text style={styles.taskUsers}>
                👤 {task.user_ids.map(user => user.name).join(', ')}
              </Text>
            )}
            {task.partner_id && task.partner_id[0] && (
              <Text style={styles.taskClient}>
                🏢 {task.partner_id[0].name}
              </Text>
            )}
            {task.expense_ids && task.expense_ids.length > 0 && (
              <Text style={styles.taskExpenses}>
                💰 {task.expense_ids.length} dépense{task.expense_ids.length > 1 ? 's' : ''}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
          <Text style={styles.errorText}>Projet non trouvé</Text>
        </View>
      </>
    );
  }

  const tasksStats = {
    total: project.task_ids?.length || 0,
    approved: project.task_ids?.filter(task => task.state === '03_approved').length || 0,
    inProgress: project.task_ids?.filter(task => task.state === '01_in_progress').length || 0,
    changesRequested: project.task_ids?.filter(task => task.state === '02_changes_requested').length || 0,
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />

      {/* Fixed Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project.name}
          </Text>
          {project.numero && (
            <Text style={styles.headerSubtitle}>{project.numero}</Text>
          )}
        </View>
        <TouchableOpacity style={styles.moreButton}>
          <Ionicons name="ellipsis-vertical" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Breadcrumb */}
        <View style={styles.breadcrumbContainer}>
          <TouchableOpacity 
            style={styles.breadcrumbItem}
            onPress={() => router.push('/(tabs)/')}
          >
            <Ionicons name="home-outline" size={14} color="#6b7280" />
            <Text style={styles.breadcrumbText}>Projets</Text>
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={12} color="#d1d5db" />
          <View style={styles.breadcrumbItem}>
            <Ionicons name="briefcase" size={14} color="#3b82f6" />
            <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>{project.name}</Text>
          </View>
        </View>

        {/* Project Info Card */}
        <View style={styles.projectInfoCard}>
          <View style={styles.projectInfoHeader}>
            <View style={styles.projectTypeIcon}>
              <Ionicons 
                name={project.project_type === 'situation' ? 'location' : 'briefcase'} 
                size={24} 
                color={project.project_type === 'situation' ? '#8b5cf6' : '#2563eb'} 
              />
            </View>
            <View style={styles.projectInfoContent}>
              <Text style={styles.projectInfoTitle}>{project.name}</Text>
              {project.numero && (
                <Text style={styles.projectInfoNumero}>#{project.numero}</Text>
              )}
              {project.partner_id && project.partner_id[0] && (
                <Text style={styles.projectInfoClient}>
                  🏢 {project.partner_id[0].name}
                </Text>
              )}
            </View>
          </View>
        </View>
        {/* Tasks Statistics */}
        <View style={styles.statsCard}>
          <Text style={styles.sectionTitle}>Statistiques des tâches</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{tasksStats.total}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#10b981' }]}>{tasksStats.approved}</Text>
              <Text style={styles.statLabel}>Approuvées</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#3b82f6' }]}>{tasksStats.inProgress}</Text>
              <Text style={styles.statLabel}>En cours</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#f59e0b' }]}>{tasksStats.changesRequested}</Text>
              <Text style={styles.statLabel}>Modifications</Text>
            </View>
          </View>
        </View>

        {/* Tasks List */}
        <View style={styles.tasksContainer}>
          <View style={styles.tasksHeader}>
            <Text style={styles.sectionTitle}>
              Tâches du projet ({project.task_ids?.length || 0})
            </Text>
            <View style={styles.progressIndicator}>
              <Text style={styles.progressText}>
                {tasksStats.approved}/{tasksStats.total} complètées
              </Text>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { width: `${tasksStats.total > 0 ? (tasksStats.approved / tasksStats.total) * 100 : 0}%` }
                  ]} 
                />
              </View>
            </View>
          </View>

          {project.task_ids && project.task_ids.length > 0 ? (
            project.task_ids.map((task, index) => (
              <TaskCard key={task.id || index} task={task} />
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="clipboard-outline" size={48} color="#9ca3af" />
              <Text style={styles.emptyText}>Aucune tâche dans ce projet</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 140, // Compenser la hauteur du header fixe
    paddingBottom: 100, // Compenser la hauteur de la tab bar
  },
  breadcrumbContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbText: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 4,
    fontWeight: '500',
  },
  breadcrumbActive: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  projectInfoCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  projectInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectTypeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  projectInfoContent: {
    flex: 1,
  },
  projectInfoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  projectInfoNumero: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '600',
    marginBottom: 4,
  },
  projectInfoClient: {
    fontSize: 14,
    color: '#6b7280',
  },
  statsCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  tasksContainer: {
    paddingHorizontal: 20,
  },
  tasksHeader: {
    marginBottom: 16,
  },
  progressIndicator: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  progressText: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    fontWeight: '500',
  },
  progressBar: {
    width: 120,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  taskStatus: {
    marginRight: 16,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  taskStatusText: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  taskUsers: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
  taskClient: {
    fontSize: 12,
    color: '#6b7280',
  },
  taskExpenses: {
    fontSize: 12,
    color: '#059669',
    marginTop: 2,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
  },
  errorText: {
    color: '#ffffff',
    fontSize: 16,
  },
});
