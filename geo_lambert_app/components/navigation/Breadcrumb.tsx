import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export interface BreadcrumbItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void; // Si undefined, l'élément n'est pas cliquable (page actuelle)
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <View style={styles.breadcrumbWrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.breadcrumbScrollContent}
        style={styles.breadcrumbScrollView}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = !isLast && item.onPress !== undefined;

          return (
            <React.Fragment key={index}>
              {isClickable ? (
                <TouchableOpacity
                  style={styles.breadcrumbItem}
                  onPress={item.onPress}
                  accessible={true}
                  accessibilityLabel={`Naviguer vers ${item.label}`}
                  accessibilityRole="button"
                >
                  <Ionicons 
                    name={item.icon} 
                    size={14} 
                    color="#6b7280" 
                  />
                  <Text style={styles.breadcrumbText}>{item.label}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.breadcrumbItem}>
                  <Ionicons 
                    name={item.icon} 
                    size={14} 
                    color={isLast ? "#3b82f6" : "#6b7280"} 
                  />
                  <Text style={[
                    styles.breadcrumbText,
                    isLast && styles.breadcrumbActive
                  ]}>
                    {item.label}
                  </Text>
                </View>
              )}
              
              {!isLast && (
                <Ionicons 
                  name="chevron-forward" 
                  size={12} 
                  color="#d1d5db" 
                />
              )}
            </React.Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  breadcrumbWrapper: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 12,
  },
  breadcrumbScrollView: {
    flexGrow: 0,
  },
  breadcrumbScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 4,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
    minWidth: 'auto',
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
});
