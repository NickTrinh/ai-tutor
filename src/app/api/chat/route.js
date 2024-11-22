// src/app/api/chat/route.js
import { Anthropic } from '@anthropic-ai/sdk';
import connectDB from '../../lib/mongoose';
import FlashcardSet from '../../models/FlashcardSet';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an AI tutor helping students learn. 
When asked to create flashcards, use the create_flashcard_set tool
Do not skip tool use when it's required. 
Always use the tool when flashcards are mentioned or implied. 
For non-flashcard requests, provide helpful educational responses without using tools. 
Do not hallucinate or make things up.`;

async function saveFlashcardSet(data) {
  console.log('Save flashcard set:', data);
  try {
    await connectDB();
    const flashcardSet = new FlashcardSet({
      title: data.title,
      cards: data.cards,
    });
    await flashcardSet.save();
    return {
      id: flashcardSet._id.toString(),
      title: flashcardSet.title,
      cardCount: flashcardSet.cards.length,
    };
  } catch (error) {
    console.error('MongoDB save error:', error);
    throw error;
  }
}

export async function POST(request) {
  try {
    const { messages } = await request.json();

    // First API call to get tool use response
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 4096,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: messages.map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      })),
      tools: [
        {
          name: 'create_flashcard_set',
          description:
            'Creates and saves a set of flashcards for studying. Use this tool when asked to make flashcards about any topic.',
          input_schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Title of the flashcard set',
              },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    term: { type: 'string' },
                    definition: { type: 'string' },
                  },
                  required: ['term', 'definition'],
                },
              },
            },
            required: ['title', 'cards'],
          },
        },
      ],
    });

    console.log(response.stop_reason);
    console.log(response.content[0].input);

    // Check if Claude wants to use a tool
    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content[0].name;

      if (toolCall === 'create_flashcard_set') {
        // Execute tool and get result
        const sets = response.content[0].input;
        const savedSet = await saveFlashcardSet(sets);

        return Response.json({
          message: `Created flashcard set: ${sets.title} with ${sets.cards.length} cards`,
          flashcardSet: savedSet,
        });
      }
    }

    // Regular response if no tool was used
    return Response.json({
      message: response.content[0].text,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    if (error.status === 400) {
      return Response.json(
        { error: `Invalid request: ${error.message}` },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}
