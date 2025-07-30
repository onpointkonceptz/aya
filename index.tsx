/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Chat, Part, Content } from "@google/genai";

// --- Type Augmentation for Web Speech API ---
// This is necessary because the Web Speech API is not yet a standard
// and TypeScript doesn't include its types by default.
interface SpeechRecognition {
    continuous: boolean;
    lang: string;
    interimResults: boolean;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    start: () => void;
    stop: () => void;
}

interface SpeechRecognitionStatic {
    new(): SpeechRecognition;
}

declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionStatic;
        webkitSpeechRecognition: SpeechRecognitionStatic;
    }
}


// --- DOM Elements ---
const messagesContainer = document.getElementById('messages-container')!;
const chatForm = document.getElementById('chat-form')!;
const promptInput = document.getElementById('prompt-input') as HTMLInputElement;
const loadingIndicator = document.getElementById('loading-indicator')!;
const uploadBtn = document.getElementById('upload-btn')!;
const micBtn = document.getElementById('mic-btn')!;
const imageUploadInput = document.getElementById('image-upload-input') as HTMLInputElement;
const imagePreviewContainer = document.getElementById('image-preview-container')!;
const closeWidgetBtn = document.getElementById('close-widget-btn')!;

// --- State ---
let uploadedImage: { mimeType: string; data: string } | null = null;
let isRecording = false;
let chat: Chat;
let chatHistory: Content[] = [];

// --- Gemini AI Configuration ---
// IMPORTANT: This API key is hardcoded for testing ONLY.
// Replace "YOUR_PASTED_GEMINI_API_KEY_HERE" with your actual Gemini API Key.
// This is a security risk for production applications!
const API_KEY = "YOUR_PASTED_GEMINI_API_KEY_HERE"; 

if (!API_KEY || API_KEY === "YOUR_PASTED_GEMINI_API_KEY_HERE") {
    addMessage('model', 'Error: API_KEY is not configured or is still a placeholder. Please set your actual API key.');
    throw new Error("API_KEY not found or is still placeholder");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

const systemInstruction = `You are Aya, a conversational AI assistant for the Federal Neuro-Psychiatric Hospital Kaduna (FNPH Kaduna). Your colors are green and yellow. Your goal is to provide information, guide users, and assist with mental and general health support.

### CORE INSTRUCTIONS
1.  **Language Proficiency**: You MUST identify the user's language (e.g., English, Hausa, Igbo, Pidgin) and respond ONLY in that same language. Maintain a natural, conversational tone in the detected language throughout the interaction.
2.  **Persona**: Be friendly, empathetic, and professional.
3.  **Emergency Protocol**: For any emergency, immediately advise the user to call the hospital at (+234) 0803 2722 243 or go to the nearest emergency room.
4.  **Fallback**: If you cannot answer a question, use this response: "I’m only able to assist with hospital services and health information. For emergencies, please call the hospital at (+234) 0803 2722 243 or go to the nearest emergency room."

### ABOUT FNPH Kaduna:
- Established in 1975 as Kakuri Psychiatric Hospital, became federal in 1996.
- Mission: “to provide quality and affordable mental healthcare… delivered by well-trained, patient-friendly mental health personnel”.
- Vision: “to be the leading centre of excellence for quality mental healthcare, mental health education and training”.
- Services include: General psychiatry, child & adolescent psychiatry, forensic psychiatry, geriatric psychiatry, community outreach, occupational therapy, psychological services, lab and pharmacy services, EEG, ECG, intensive care, GOPD, MGOPD.
- Location: Aliyu Makama Road, Barnawa Low-Cost, Kaduna.
- Contact: (+234) 0803 2722 243 or info@fnphkaduna.com.
- Campus Navigation: The emergency block is located at the right hand side, just after the entrance, behind is the GOPD, after the emergency is the main admin block. Offices in the general admin block include the medical director Prof. Aishatu Yusha'u Armiyau office, head of clinical services office, Dr. Nafisatu Hayatudeen, Mal. Isah Mohd Sanusi (The Ag. Head of Administration Department), and head of human resource office, head of general account Mr. Lucky Abumare office, head of nursing services, head of pharmacy, pharmacy, audit office, grants and collaboration office, conference hall, reception and front desk, security, procurement, information and protocol, HR and registry offices are all found in the admin block. Behind the admin block is the central store, just after it is the central mosque and chapel, on the left wing is the child & adolescent unit, beside the child & adolescent is the daycare centre facing the open field (green grass area). The first building by your left when you take right in the T junction after the admin block is the toxicology ward also facing the field (green grass area), after it is the EEG/ECT building, then the new male ward or heroes villa. The building facing the T junction after the admin block is the works and maintenance unit, a link road will lead you to the occupational therapy, transport units, service bay, environmental office. When you walk or drive straight down without taking turns, the medical library is on the left, the senior citizens villa is on the left, the link road facing the senior citizens villa will lead you to the champions arena (football field). Just opposite the champions arena is the female ward, school of post basic psychiatric nursing, and their Queen Amina hostel opposite the senior citizens villa. The quarters is by the left too after senior citizens villa. Dater ward is behind the child and adolescent unit, that road can also link to the female ward, champions arena, and school. At the left hand side by the entrance is the visitors car park, then the Prof. Jika COVID-19 complex, there you can find the MGOPD, ICU, Nephrology Units. The medical laboratory and NHIA is behind the admin block.`;

// --- Speech Recognition ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition: SpeechRecognition | null = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => {
        isRecording = true;
        micBtn.classList.add('recording');
    };

    recognition.onend = () => {
        isRecording = false;
        micBtn.classList.remove('recording');
    };

    recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim();
        promptInput.value = transcript;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        addMessage('model', `Sorry, I couldn't hear you. Error: ${event.error}`);
    };
}

// --- Chat History ---
function saveChatHistory() {
    localStorage.setItem('fnphChatHistory', JSON.stringify(chatHistory));
}

// --- Chat Logic ---
async function handleSendMessage(message: string, image: typeof uploadedImage = null) {
  if (!message && !image) {
    return; // Don't send empty messages
  }

  // Disable all previous interactive buttons
  disablePreviousOptions();

  // Client-side mapping for menu options to improve reliability.
  const menuOptions: { [key: string]: string } = {
    '1': 'Book an appointment',
    '2': 'Find a department or person',
    '3': 'Get health advice',
    '4': 'See hospital hours & updates'
  };
  
  // Use the full text for the API if it's a menu option, otherwise use the original message.
  const messageForApi = menuOptions[message.trim()] || message;

  displayUserMessage(message, image ? `data:${image.mimeType};base64,${image.data}` : undefined);
  const userMessageElement = messagesContainer.lastChild; // Grab for potential removal on error
  setLoading(true);
  promptInput.value = '';
  clearImagePreview();

  try {
    const parts: Part[] = [];
    if (image) {
        parts.push({
            inlineData: {
                mimeType: image.mimeType,
                data: image.data,
            },
        });
    }
    if (messageForApi) {
        parts.push({ text: messageForApi });
    }
    
    // Add user message to history and save
    chatHistory.push({ role: 'user', parts });
    saveChatHistory();

    const responseStream = await chat.sendMessageStream({ message: parts });
    let modelResponse = '';
    const modelMessageElement = addMessage('model', '');

    for await (const chunk of responseStream) {
      modelResponse += chunk.text;
      // Basic markdown to HTML conversion
      let formattedResponse = modelResponse
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

      modelMessageElement.innerHTML = formattedResponse;
      scrollToBottom();
    }
    
    // Add model response to history and save
    chatHistory.push({ role: 'model', parts: [{text: modelResponse}] });
    saveChatHistory();

    // After streaming, parse response for lists and add interactive options
    const listRegex = /^(?:\d+\.|\*|-)\s(.+)$/gm;
    const matches = modelResponse.match(listRegex);
    if (matches && matches.length > 1) { // Only for lists with more than 1 item
        const options = matches.map(match => match.replace(/^(?:\d+\.|\*|-)\s/, '').trim());
        createInteractiveOptions(modelMessageElement, options);
    }

  } catch (error) {
    console.error('Error sending message:', error);
    addMessage('model', 'Sorry, I couldn\'t connect. Please check your internet connection and try again.');
    // Remove the failed user message from history and the DOM
    chatHistory.pop();
    saveChatHistory();
    userMessageElement?.remove();
  } finally {
    setLoading(false);
  }
}

// --- UI Helper Functions ---
function addMessage(role: 'model' | 'user', text: string): HTMLElement {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', role);
    messageElement.innerHTML = text;
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
}

function displayUserMessage(text: string, imageUrl?: string) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', 'user');

    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = "User uploaded image";
        messageElement.appendChild(img);
    }
    if (text) {
        const p = document.createElement('p');
        // For history rendering, map number back to full text for clarity
        const menuOptions: { [key: string]: string } = { '1': '1. Book an appointment', '2': '2. Find a department or person', '3': '3. Get health advice', '4': '4. See hospital hours & updates' };
        p.textContent = menuOptions[text.trim()] || text;
        messageElement.appendChild(p);
    }
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

function handleImageUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please upload a valid image file.');
        return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        uploadedImage = {
            mimeType: file.type,
            data: base64String
        };
        displayImagePreview(`data:${file.type};base64,${base64String}`);
    };
    reader.readAsDataURL(file);
}

function displayImagePreview(dataUrl: string) {
    imagePreviewContainer.innerHTML = ''; // Clear previous
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-wrapper';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = "Image preview";

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-preview';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Remove image');
    closeBtn.onclick = clearImagePreview;

    wrapper.appendChild(img);
    wrapper.appendChild(closeBtn);
    imagePreviewContainer.appendChild(wrapper);
    imagePreviewContainer.classList.remove('hidden');
}

function clearImagePreview() {
    uploadedImage = null;
    imagePreviewContainer.innerHTML = '';
    imagePreviewContainer.classList.add('hidden');
    imageUploadInput.value = '';
}

function setLoading(isLoading: boolean) {
    loadingIndicator.classList.toggle('hidden', !isLoading);
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createInteractiveOptions(parentElement: HTMLElement, options: string[], isInitialMenu: boolean = false) {
    const existingOptions = parentElement.querySelector('.interactive-options');
    if (existingOptions) return; // Don't add options twice

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'interactive-options';

    options.forEach((optionText, index) => {
        const button = document.createElement('button');
        button.className = 'option-button';
        // Prepend number for initial menu for clarity
        button.textContent = isInitialMenu ? `${index + 1}. ${optionText}` : optionText;
        
        button.onclick = () => {
            // Disable all buttons in this group
            optionsContainer.querySelectorAll('.option-button').forEach(btn => {
                (btn as HTMLButtonElement).disabled = true;
                btn.classList.add('disabled');
            });
            
            // For the initial menu, send the number. Otherwise, send the text.
            const messageToSend = isInitialMenu ? (index + 1).toString() : optionText;
            handleSendMessage(messageToSend);
        };
        optionsContainer.appendChild(button);
    });

    parentElement.appendChild(optionsContainer);
    scrollToBottom();
}

function disablePreviousOptions() {
    const allButtons = document.querySelectorAll('.option-button:not(:disabled)');
    allButtons.forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
        btn.classList.add('disabled');
    });
}

// --- Event Listeners ---
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = promptInput.value.trim();
    if (message || uploadedImage) {
      handleSendMessage(message, uploadedImage);
    }
});

uploadBtn.addEventListener('click', () => {
    imageUploadInput.click();
});
imageUploadInput.addEventListener('change', handleImageUpload);


micBtn.addEventListener('click', () => {
    if (!recognition) {
        alert('Speech recognition is not supported in your browser.');
        return;
    }
    if (isRecording) {
        recognition.stop();
    } else {
        try {
            recognition.start();
        } catch (e) {
            console.error("Could not start recognition:", e);
             addMessage('model', `Could not start voice recognition. Please check your microphone permissions.`);
        }
    }
});

closeWidgetBtn.addEventListener('click', () => {
    // Send a message to the parent window to close the iframe
    window.parent.postMessage({ type: 'AyaWidget-close' }, '*');
});

// --- Initial State & History Rendering ---
function renderHistory() {
    messagesContainer.innerHTML = '';
    chatHistory.forEach(message => {
        if (message.role === 'user') {
            const textPart = message.parts.find(p => 'text' in p) as { text: string } | undefined;
            const imagePart = message.parts.find(p => 'inlineData' in p) as { inlineData: { mimeType: string, data: string } } | undefined;
            const text = textPart?.text || '';
            const imageUrl = imagePart ? `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` : undefined;
            displayUserMessage(text, imageUrl);
        } else if (message.role === 'model') {
            const modelResponseText = (message.parts[0] as {text: string}).text;
            let formattedResponse = modelResponseText
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>');
            
            const messageElement = addMessage('model', formattedResponse);
            
            const listRegex = /^(?:\d+\.|\*|-)\s(.+)$/gm;
            const matches = modelResponseText.match(listRegex);
            if (matches && matches.length > 1) {
                const options = matches.map(match => match.replace(/^(?:\d+\.|\*|-)\s/, '').trim());
                createInteractiveOptions(messageElement, options, false);
            }
        }
    });

    // Disable all interactive options in the restored history view
    messagesContainer.querySelectorAll('.option-button').forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
        btn.classList.add('disabled');
    });

    scrollToBottom();
}

function displayInitialWelcome() {
  const welcomeMessage = `Hi! I'm <strong>Aya</strong>, your friendly assistant for FNPH Kaduna. How can I help you today?<br><br>You can ask me anything, or choose an option below by clicking it or typing its number:`;
  const initialOptions = [
      'Book an appointment',
      'Find a department or person',
      'Get health advice',
      'See hospital hours & updates'
  ];

  const messageElement = addMessage('model', welcomeMessage);
  createInteractiveOptions(messageElement, initialOptions, true);
}

function loadAndInitializeChat() {
    const savedHistory = localStorage.getItem('fnphChatHistory');
    if (savedHistory) {
        try {
            chatHistory = JSON.parse(savedHistory);
        } catch(e) {
            console.error("Could not parse chat history:", e);
            chatHistory = [];
        }
    }

    // Always create the chat object, with or without history
    chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        history: chatHistory,
        config: {
          systemInstruction,
        },
    });

    if (chatHistory.length > 0) {
        renderHistory();
    } else {
        displayInitialWelcome();
    }
}

loadAndInitializeChat();
