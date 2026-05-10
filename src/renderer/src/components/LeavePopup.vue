<script setup lang="ts">
import Popup from './Popup.vue'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
}>()

function leave() {
  window.close()
}

function cancel() {
  emit('cancel')
}
</script>
<template>
  <Popup
    title="Are you sure you want to exit?"
    icon="md-exittoapp-outlined"
    :visible="props.show"
    okText="Yes, exit"
    cancelText="No, stay"
    @ok="leave"
    @cancel="cancel"
  >
  </Popup>
</template>
