import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  StatusBar,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUserAuth, useCurrentUser } from '@/contexts/UserAuthContext';
import { router } from 'expo-router';
import projectService from '@/services/projectService';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const { refreshSession, error } = useUserAuth();
  const user = useCurrentUser();
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalTasks: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    completionRate: 0,
    situationProjects: 0,
    normalProjects: 0,
    totalExpenses: 0,
    expenseCount: 0
  });


  // Charger les données au démarrage
  useEffect(() => {
    loadProjects();
  }, []);

  // Fonction pour récupérer les projets depuis le service
  const loadProjects = async () => {
    try {
      setLoading(true);
      console.log('📊 Chargement des projets via taskService...');
      
      const response = await projectService.getProjects();
      
      if (response.success && response.result) {
        // @ts-ignore
          setProjects(response.result);
        const calculatedStats = projectService.calculateProjectStats(response.result);
        setStats(calculatedStats);
        console.log(`📊 ${response.result.length} projets chargés via service`);
      } else {
        console.warn('⚠️ Erreur service projets:', response.message);
        throw new Error(response.message || 'Erreur de récupération des projets');
      }

    } catch (error) {
      console.error('❌ Erreur chargement projets:', error);
      // En cas d'erreur, on peut décider de garder les anciennes données ou les vider
      if (projects.length === 0) {
        // Si on n'a pas de données précédentes, on met des valeurs par défaut
        setStats({
          totalProjects: 0,
          totalTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          completionRate: 0,
          situationProjects: 0,
          normalProjects: 0,
          totalExpenses: 0,
          expenseCount: 0
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSession();
      await loadProjects(); // Recharger aussi les projets
    } catch (error) {
      console.error('Erreur refresh:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSession]);

  const QuickActionCard = ({ icon, title, description, onPress, color = '#2563eb' }) => (
    <TouchableOpacity style={styles.actionCard} onPress={onPress}>
      <View style={[styles.actionIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <View style={styles.actionContent}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
    </TouchableOpacity>
  );

  const StatCard = ({ icon, value, label, color = '#2563eb' }) => (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const formatTime = (date) => {
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleProjectPress = (project) => {
    console.log('🎯 Navigation vers projet:', project.name);
    router.push({
      pathname: '/(tabs)/project-details',
      params: {
        project: JSON.stringify(project),
        projectName: project.name
      }
    });
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
      
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>
              {getGreeting()}{user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}
            </Text>
            <Text style={styles.date}>{formatDate(currentTime)}</Text>
          </View>

        </View>
      </View>
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >

        {/* Company Banner */}
        <View style={styles.companyBanner}>
          <Image
            source={require('../../assets/images/geo-lambert.png')}
            style={styles.companyLogo}
            resizeMode="contain"
          />
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>GEO LAMBERT</Text>
            <Text style={styles.companySlogan}>L'Art de mesure et de précision</Text>
            <Text style={styles.companyDescription}>
              Solutions géomatiques professionnelles
            </Text>
          </View>
        </View>

        {/* Stats Section */}
        <View style={styles.statsContainer}>
          <Text style={styles.sectionTitle}>Aperçu</Text>
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Chargement des données...</Text>
            </View>
          ) : (
            <View style={styles.statsGrid}>
              <StatCard
                icon="briefcase-outline"
                value={stats.totalProjects.toString()}
                label="Projets"
                color="#10b981"
              />
              <StatCard
                icon="list-outline"
                value={stats.totalTasks.toString()}
                label="Tâches"
                color="#3b82f6"
              />
              <StatCard
                icon="analytics-outline"
                value={`${stats.completionRate || 0}%`}
                label="Complétion"
                color="#8b5cf6"
              />
              <StatCard
                icon="wallet-outline"
                value={stats.expenseCount.toString()}
                label="Dépenses"
                color="#ef4444"
              />
            </View>
          )}
        </View>

        {/* Recent Projects */}
        <View style={styles.activityContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Projets récents</Text>
            <TouchableOpacity style={styles.viewAllButton}>
              <Text style={styles.viewAllText}>Voir tout</Text>
              <Ionicons name="chevron-forward" size={14} color="#3b82f6" />
            </TouchableOpacity>
          </View>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Chargement des projets...</Text>
            </View>
          ) : projects.length > 0 ? (
            projects.slice(0, 5).map(project => (
              <TouchableOpacity 
                key={project.id} 
                style={styles.projectCard}
                onPress={() => handleProjectPress(project)}
                activeOpacity={0.7}
              >
                <View style={styles.projectIcon}>
                  <Ionicons 
                    name={project.project_type === 'situation' ? 'location' : 'briefcase'} 
                    size={20} 
                    color={project.project_type === 'situation' ? '#8b5cf6' : '#2563eb'} 
                  />
                </View>
                <View style={styles.projectContent}>
                  <View style={styles.projectHeader}>
                    <Text style={styles.projectTitle}>{project.name}</Text>
                    {project.numero && (
                      <View style={styles.numeroTag}>
                        <Text style={styles.numeroText}>{project.numero}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.projectDetails}>
                    {project.task_ids?.length || 0} tâches
                    {project.partner_id && project.partner_id[0] ? 
                      ` • ${project.partner_id[0].name}` : 
                      ''
                    }
                  </Text>
                  <View style={styles.projectMeta}>
                    <Text style={styles.projectType}>
                      {project.project_type === 'situation' ? '📍 Situation' : '📋 Normal'}
                    </Text>
                    {project.date_start && (
                      <Text style={styles.projectDate}>
                      📅 {new Date(project.date_start).toLocaleDateString('fr-FR')}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.projectStatus}>
                <View style={styles.statusIndicator}>
                <View style={[
                  styles.statusDot,
                    { backgroundColor: project.task_ids?.some(task => task.state === '01_in_progress') ? '#3b82f6' : '#10b981' }
                  ]} />
                  </View>
                    <Ionicons name="chevron-forward" size={16} color="#9ca3af" style={{ marginLeft: 8 }} />
                  </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="briefcase-outline" size={48} color="#9ca3af" />
              <Text style={styles.emptyText}>Aucun projet trouvé</Text>
            </View>
          )}
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning" size={20} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>GEO LAMBERT</Text>
          <Text style={styles.footerSubtext}>
            Expertise géomatique depuis 1985
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 140, // Compenser la hauteur du header fixe
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'capitalize',
  },
  time: {
    fontSize: 32,
    fontWeight: '300',
    color: '#ffffff',
  },
  companyBanner: {
    backgroundColor: '#ffffff',
    margin: 20,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  companyLogo: {
    width: 80,
    height: 48,
    marginRight: 16,
  },
  companyInfo: {
    flex: 1,
  },
  companyName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 4,
  },
  companySlogan: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
    marginBottom: 2,
  },
  companyDescription: {
    fontSize: 12,
    color: '#9ca3af',
  },
  statsContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    backgroundColor: '#ffffff',
    width: (width - 60) / 2,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
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
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
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
  actionsContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  actionCard: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  actionDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  activityContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 20,
  },
  viewAllText: {
    fontSize: 12,
    color: '#3b82f6',
    fontWeight: '600',
    marginRight: 4,
  },
  activityCard: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 12,
    color: '#6b7280',
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  projectCard: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  projectContent: {
    flex: 1,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  projectTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
  },
  numeroTag: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  numeroText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  projectDetails: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 6,
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectType: {
    fontSize: 12,
    color: '#8b5cf6',
    fontWeight: '500',
  },
  projectDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  projectStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  statusIndicator: {
    alignItems: 'center',
    marginRight: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
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
});
