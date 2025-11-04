import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { DatabaseQueries } from '../src/database/queries';
import { pool } from '../src/database/db';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

interface TrainingDocument {
  filename: string;
  content: string;
  category: string;
  metadata: Record<string, any>;
}

async function parseTrainingFile(filePath: string): Promise<TrainingDocument> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  
  // Detect category from filename or content
  let category = 'general';
  const categoryPatterns = {
    'commission': /commission|payment|advance|chargeback/i,
    'healthsherpa': /healthsherpa|portal|application|enrollment/i,
    'carriers': /carrier|bcbs|uhc|aetna|cigna|anthem/i,
    'compliance': /compliance|cms|regulation|audit/i,
    'training': /training|procedure|process|guide/i
  };
  
  for (const [cat, pattern] of Object.entries(categoryPatterns)) {
    if (pattern.test(filename) || pattern.test(content.substring(0, 1000))) {
      category = cat;
      break;
    }
  }
  
  // Extract any metadata from the file (if it has front matter)
  let metadata: Record<string, any> = {
    source_file: filename,
    ingested_at: new Date().toISOString()
  };
  
  // Check for YAML front matter
  const frontMatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (frontMatterMatch) {
    // Parse front matter (simplified - you might want to use a YAML parser)
    const frontMatter = frontMatterMatch[1];
    frontMatter.split('\n').forEach(line => {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        metadata[key] = value;
      }
    });
  }
  
  return {
    filename,
    content: content.replace(/^---\n[\s\S]+?\n---\n/, ''), // Remove front matter
    category,
    metadata
  };
}

async function ingestTrainingData() {
  console.log('🚀 Starting training data ingestion...');
  
  // Initialize embeddings
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY!,
    modelName: "text-embedding-3-large"
  });

  // Initialize text splitter
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", ". ", " ", ""]
  });

  // Get all training files
  const trainingDir = path.join(__dirname, '../training_data');
  
  if (!fs.existsSync(trainingDir)) {
    fs.mkdirSync(trainingDir, { recursive: true });
    console.log('📁 Created training_data directory. Please add your training files there.');
    return;
  }

  const files = fs.readdirSync(trainingDir).filter(f => 
    f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.json')
  );

  if (files.length === 0) {
    console.log('⚠️ No training files found in training_data directory');
    console.log('Add .txt, .md, or .json files with your training content');
    return;
  }

  console.log(`📄 Found ${files.length} training files`);

  let totalChunks = 0;
  let totalErrors = 0;

  for (const file of files) {
    try {
      console.log(`\n📖 Processing ${file}...`);
      
      const filePath = path.join(trainingDir, file);
      const document = await parseTrainingFile(filePath);
      
      // Split into chunks
      const chunks = await textSplitter.splitText(document.content);
      console.log(`   Split into ${chunks.length} chunks`);
      
      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Skip empty chunks
        if (chunk.trim().length < 50) continue;
        
        try {
          // Generate embedding
          const embedding = await embeddings.embedQuery(chunk);
          
          // Store in database
          await DatabaseQueries.insertKnowledgeBase({
            content: chunk,
            title: `${document.filename} - Part ${i + 1}`,
            category: document.category,
            subcategory: undefined,
            metadata: {
              ...document.metadata,
              chunk_index: i,
              total_chunks: chunks.length
            },
            embedding,
            source: document.filename,
            source_type: 'training_transcript'
          });
          
          totalChunks++;
          
          // Show progress
          if ((i + 1) % 10 === 0) {
            console.log(`   ✓ Processed ${i + 1}/${chunks.length} chunks`);
          }
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`   ✗ Error processing chunk ${i + 1}:`, error);
          totalErrors++;
        }
      }
      
      console.log(`   ✅ Completed ${file}`);
      
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
      totalErrors++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Ingestion complete!`);
  console.log(`   Total chunks processed: ${totalChunks}`);
  console.log(`   Total errors: ${totalErrors}`);
  
  // Close database connection
  await pool.end();
  process.exit(0);
}

// Run the ingestion
ingestTrainingData().catch(error => {
  console.error('Fatal error during ingestion:', error);
  process.exit(1);
});
