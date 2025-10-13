import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Alert,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import projectService, { subscribeToProjectUpdates, subscribeToProjectsCleared, subscribeToProjectDeleted, subscribeToTaskDeleted } from '@/services/projectService';

export default function ProjectDetailsScreen() {
  const params = useLocalSearchParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Animation pour l'icône de refresh
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (refreshing) {
      // Démarrer l'animation de rotation
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      // Réinitialiser l'animation
      rotateAnim.setValue(0);
    }
  }, [refreshing]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Load project from API
  const loadProjectDetails = async (projectId: number) => {
    try {
      console.log('📋 Chargement des détails du projet:', projectId);
      const response = await projectService.getProjects();
      
      if (response.success && response.result) {
        const updatedProject = response.result.find(p => p.id === projectId);
        if (updatedProject) {
          setProject(updatedProject);
          console.log('✅ Projet mis à jour:', updatedProject.name);
        } else {
          console.warn('⚠️ Projet non trouvé dans la réponse');
        }
      }
    } catch (error) {
      console.error('❌ Erreur chargement projet:', error);
    }
  };

  useEffect(() => {
    if (params.project) {
      try {
        const projectData = JSON.parse(params.project as string);
        setProject(projectData);
        setLoading(false);
        // Auto-refresh on mount
        if (projectData.id) {
          loadProjectDetails(projectData.id);
        }
      } catch (error) {
        console.error('Erreur parsing project data:', error);
        Alert.alert('Erreur', 'Impossible de charger les détails du projet');
        router.back();
      }
    }
  }, [params.project]);

  // 🔄 S'abonner aux mises à jour WebSocket du projet
  // @ts-ignore
    useEffect(() => {
    if (!project) return;
    
    console.log('🔔 Abonnement aux mises à jour du projet:', project.id);
    
    const unsubscribe = subscribeToProjectUpdates((updatedProject) => {
      // Vérifier si c'est notre projet
      // @ts-ignore
        if (updatedProject.id === project.id) {
        console.log('🔄 Projet mis à jour via WebSocket:', updatedProject.id);
        // @ts-ignore
          setProject(updatedProject);
      }
    });
    
    return () => {
      console.log('🧹 Désabonnement des mises à jour du projet:', project.id);
      unsubscribe();
    };
  }, [project?.id]);

  // 🗑️ S'abonner aux suppressions de tâches WebSocket
  useEffect(() => {
    if (!project) return;
    
    console.log('🔔 Abonnement aux suppressions de tâches (project-details)...');
    
    const unsubscribe = subscribeToTaskDeleted(({ projectId, taskId }) => {
      // Vérifier si la tâche supprimée appartient à notre projet
      if (projectId === project.id) {
        console.log('🗑️ Tâche supprimée du projet:', taskId);
        
        // ✅ Mettre à jour le projet en retirant la tâche supprimée
        // Rester sur la page même si le projet n'a plus de tâches
        setProject(prevProject => {
          if (!prevProject || !prevProject.task_ids) return prevProject;
          
          return {
            ...prevProject,
            task_ids: prevProject.task_ids.filter(t => t.id !== taskId)
          };
        });
      }
    });
    
    return () => {
      console.log('🧹 Désabonnement des suppressions de tâches (project-details)');
      unsubscribe();
    };
  }, [project?.id]);

  // 🗑️ S'abonner aux suppressions de projets WebSocket
  useEffect(() => {
    if (!project) return;
    
    console.log('🔔 Abonnement aux suppressions de projets (project-details)...');
    
    const unsubscribe = subscribeToProjectDeleted((deletedProjectId) => {
      // Vérifier si c'est notre projet qui a été supprimé
      if (deletedProjectId === project.id) {
        console.log('🗑️ Projet supprimé via WebSocket:', deletedProjectId);
        
        // ✅ Mettre à jour le state pour indiquer que le projet est supprimé
        setProject(prev => prev ? { ...prev, task_ids: [] } : null);
      }
    });
    
    return () => {
      console.log('🧹 Désabonnement des suppressions de projets (project-details)');
      unsubscribe();
    };
  }, [project?.id]);

  // 🗑️ S'abonner au vidage du cache
  useEffect(() => {
    console.log('🔔 Abonnement au vidage du cache (project-details)...');
    
    const unsubscribe = subscribeToProjectsCleared(() => {
      console.log('🗑️ Cache vidé - Données en cache supprimées');
      // ✅ Ne pas rediriger, juste logger
      // L'utilisateur peut rafraîchir manuellement pour recharger les données
    });
    
    return () => {
      console.log('🧹 Désabonnement du vidage du cache (project-details)');
      unsubscribe();
    };
  }, []);

  const onRefresh = React.useCallback(async () => {
    if (!project) return;
    
    setRefreshing(true);
    const startTime = Date.now();
    
    try {
      console.log('🔄 Rafraîchissement du projet...');
      await loadProjectDetails(project.id);
    } catch (error) {
      console.error('❌ Erreur refresh:', error);
    } finally {
      // Assurer un délai minimum de 1 seconde
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsedTime);
      
      setTimeout(() => {
        setRefreshing(false);
      }, remainingTime);
    }
  }, [project]);

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

  const formatDate = (dateString) => {
    if (!dateString) return 'Date non définie';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
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
        style={styles.taskCard}
        onPress={() => handleTaskPress(task)}
        activeOpacity={0.7}
      >
        {/* Barre de statut colorée à gauche */}
        <View style={[styles.taskStatusBar, { backgroundColor: statusColors.borderColor }]} />
        
        <View style={styles.taskCardContent}>
          {/* Header avec icône et titre */}
          <View style={styles.taskCardHeader}>
            <View style={[styles.taskStatusIcon, { backgroundColor: statusColors.backgroundColor }]}>
              <Ionicons name={statusIcon.name} size={22} color={statusIcon.color} />
            </View>
            <View style={styles.taskTitleContainer}>
              <Text style={styles.taskTitle} numberOfLines={2}>{task.name}</Text>
              <View style={[styles.taskStatusBadge, { backgroundColor: statusColors.backgroundColor }]}>
                <Text style={[styles.taskStatusText, { color: statusColors.textColor }]}>
                  {getTaskStatusText(task.state)}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.taskChevron} />
          </View>

          {/* Informations de la tâche */}
          <View style={styles.taskDetails}>
            {task.user_ids && task.user_ids.length > 0 && (
              <View style={styles.taskInfoItem}>
                <Ionicons name="person" size={14} color="#6b7280" />
                <Text style={styles.taskInfoText} numberOfLines={1}>
                  {task.user_ids.map(user => user.name).join(', ')}
                </Text>
              </View>
            )}
            {task.partner_id && task.partner_id[0] && (
              <View style={styles.taskInfoItem}>
                <Ionicons name="business" size={14} color="#6b7280" />
                <Text style={styles.taskInfoText} numberOfLines={1}>
                  {task.partner_id[0].name}
                </Text>
              </View>
            )}
            {task.expense_ids && task.expense_ids.length > 0 && (
              <View style={styles.taskInfoItem}>
                <Ionicons name="wallet" size={14} color="#059669" />
                <Text style={[styles.taskInfoText, { color: '#059669', fontWeight: '600' }]}>
                  {task.expense_ids.length} dépense{task.expense_ids.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>

          {/* Section avances (si présentes) */}
          {((task.advance_amount !== undefined && task.advance_amount !== null && task.advance_amount > 0) || task.advance_date) && (
            <View style={styles.taskAdvanceContainer}>
              <View style={styles.taskAdvanceDivider} />
              <View style={styles.taskAdvanceContent}>
                {/* Montant d'avance */}
                {task.advance_amount !== undefined && task.advance_amount !== null && task.advance_amount > 0 && (
                  <View style={styles.taskAdvanceBadge}>
                    <Ionicons name="cash" size={12} color="#10b981" />
                    <Text style={styles.taskAdvanceText}>
                      {task.advance_amount.toFixed(2)} MAD
                    </Text>
                  </View>
                )}
                {/* Date d'avance */}
                {task.advance_date && (
                  <View style={styles.taskAdvanceBadge}>
                    <Ionicons name="calendar" size={12} color="#3b82f6" />
                    <Text style={styles.taskAdvanceText}>
                      {formatDate(task.advance_date)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
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

      {/* Refresh Indicator - Same as index */}
      {refreshing && (
        <View style={styles.refreshOverlay}>
          <View style={styles.refreshCard}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Ionicons name="reload" size={40} color="#3b82f6" />
            </Animated.View>
            <Text style={styles.refreshOverlayText}>Actualisation...</Text>
          </View>
        </View>
      )}

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

        {/* Project Info Card with Statistics */}
        <View style={styles.projectInfoCard}>
          {/* En-tête avec titre */}
          <View style={styles.projectInfoHeader}>
            <View style={styles.projectIconContainer}>
              <Ionicons 
                name={project.project_type === 'situation' ? 'location' : 'briefcase'} 
                size={28} 
                color={project.project_type === 'situation' ? '#8b5cf6' : '#2563eb'} 
              />
            </View>
            <View style={styles.projectInfoTitleContainer}>
              <Text style={styles.projectInfoTitle}>{project.name}</Text>
              {project.numero && (
                <View style={styles.numeroChip}>
                  <Ionicons name="pricetag" size={12} color="#3b82f6" />
                  <Text style={styles.projectInfoNumero}>#{project.numero}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Séparateur */}
          {project.partner_id && project.partner_id[0] && (
            <>
              <View style={styles.projectInfoDivider} />
              
              {/* Informations principales */}
              <View style={styles.projectInfoSection}>
                {/* Client */}
                <View style={styles.projectInfoRow}>
                  <View style={styles.projectInfoLabelContainer}>
                    <Ionicons name="business-outline" size={18} color="#6b7280"/>
                    <Text style={styles.projectInfoLabel}>Client</Text>
                  </View>
                  <Text style={styles.projectInfoValue} numberOfLines={2}>
                    {project.partner_id[0].name}
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* Séparateur avant statistiques */}
          <View style={styles.projectInfoDivider} />

          {/* Statistiques des tâches */}
          <View style={styles.statsSection}>
            <View style={styles.statsSectionHeader}>
              <Ionicons name="stats-chart" size={18} color="#8b5cf6" />
              <Text style={styles.statsSectionTitle}>Statistiques des tâches</Text>
            </View>
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
  refreshOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  refreshCard: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 32,
    paddingVertical: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  refreshOverlayText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
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
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  projectInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 16,
  },
  projectIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  projectInfoTitleContainer: {
    flex: 1,
  },
  projectInfoTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
    lineHeight: 28,
    marginBottom: 6,
  },
  numeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  projectInfoNumero: {
    fontSize: 13,
    color: '#3b82f6',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  projectInfoDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginHorizontal: 20,
  },
  projectInfoSection: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  projectInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  projectInfoLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 80,
  },
  projectInfoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  projectInfoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  // Section statistiques dans la carte projet
  statsSection: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#faf5ff',
  },
  statsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8b5cf6',
    letterSpacing: 0.2,
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
  // Tasks Section
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
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
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    flexDirection: 'row',
  },
  taskStatusBar: {
    width: 4,
  },
  taskCardContent: {
    flex: 1,
    padding: 16,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  taskStatusIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  taskTitleContainer: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 6,
    lineHeight: 22,
  },
  taskStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  taskStatusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  taskChevron: {
    marginLeft: 8,
    marginTop: 2,
  },
  taskDetails: {
    gap: 8,
  },
  taskInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskInfoText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
    flex: 1,
  },
  // Section avances dans TaskCard
  taskAdvanceContainer: {
    marginTop: 12,
  },
  taskAdvanceDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginBottom: 10,
  },
  taskAdvanceContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskAdvanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  taskAdvanceText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
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
